// Opens every published Windows artifact and checks every executable in it.
//
// Signing the outer installer says nothing about what the installer lays down
// (issue #365): the app executable, the elevate helper and the uninstaller
// are separate PE files with their own signatures. This verifier unpacks each
// installer the way a user's machine would end up seeing it — NSIS container,
// then the embedded app archive — and reports, per executable, whether it
// carries an Authenticode signature. With `requireSigned` an unsigned or
// absent executable is fatal. Prefer failing loudly: an installer that cannot
// be opened, or that does not contain what it must, never passes by omission.
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import process from 'node:process'
import { parseArgs } from 'node:util'

import { comparePayload, snapshotTree } from './windows-signing/payload.mjs'
import { hasAuthenticodeSignature } from './windows-signing/pe-signature.mjs'
import { runTool } from './windows-signing/signing-backends.mjs'
import {
  APP_EXECUTABLES,
  ELEVATE_HELPER,
  INSTALLED_UNINSTALLER,
  installerName,
  listExecutables,
  portableName
} from './windows-signing/signing-plan.mjs'

/** Extracts `archive` into `dest` with 7-Zip (zip, 7z and NSIS installers alike). */
export async function sevenZipExtract(archive, dest, sevenZip = process.env.VARLENS_7Z || '7z') {
  mkdirSync(dest, { recursive: true })
  const result = await runTool(sevenZip, ['x', '-y', `-o${dest}`, archive])
  if (result.code !== 0) {
    throw new Error(`7-Zip could not extract ${basename(archive)} (exit ${result.code})`)
  }
}

function findEmbeddedArchives(dir) {
  const found = []
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.toLowerCase().endsWith('.7z')) found.push(full)
    }
  }
  walk(dir)
  return found
}

/** Unpacks an NSIS installer into its container files and the app it installs. */
export async function extractInstaller({ artifactPath, workDir, extract = sevenZipExtract }) {
  const outerDir = join(workDir, 'installer')
  const appDir = join(workDir, 'app')
  rmSync(workDir, { recursive: true, force: true })
  await extract(artifactPath, outerDir)
  const embedded = findEmbeddedArchives(outerDir)
  if (embedded.length !== 1) {
    throw new Error(
      `${basename(artifactPath)}: expected exactly one embedded app archive, found ${embedded.length}`
    )
  }
  await extract(embedded[0], appDir)
  return { outerDir, appDir }
}

function executablesUnder(root) {
  return listExecutables(root).map((path) => {
    const absolute = join(root, path)
    return { path, absolute, signed: hasAuthenticodeSignature(absolute) }
  })
}

async function inspectInstaller({ name, kind, dir, workDir, extract, reference }) {
  const artifactPath = join(dir, name)
  if (!existsSync(artifactPath)) throw new Error(`missing Windows artifact: ${name}`)
  const { outerDir, appDir } = await extractInstaller({
    artifactPath,
    workDir: join(workDir, kind),
    extract
  })
  const inner = [...executablesUnder(outerDir), ...executablesUnder(appDir)]
  const required = [...APP_EXECUTABLES, ELEVATE_HELPER]
  if (kind === 'installer') required.push(INSTALLED_UNINSTALLER)
  const missing = required.filter(
    (wanted) => !inner.some(({ path }) => path === wanted || basename(path) === wanted)
  )
  return {
    name,
    kind,
    signed: hasAuthenticodeSignature(artifactPath),
    absolute: artifactPath,
    executables: inner,
    missing,
    payloadDifferences: reference
      ? await comparePayload(reference, appDir, { allowedExtra: [ELEVATE_HELPER] })
      : []
  }
}

/**
 * Inspects the published Windows artifact set in `dir`. `reference` is an
 * optional snapshot (payload.mjs `snapshotTree`) of the promoted app
 * directory; when given, each installer's payload is compared against it.
 */
export async function inspectWindowsRelease({ dir, version, workDir, extract, reference = null }) {
  const artifacts = []
  for (const [kind, name] of [
    ['installer', installerName(version)],
    ['portable', portableName(version)]
  ]) {
    artifacts.push(await inspectInstaller({ name, kind, dir, workDir, extract, reference }))
  }
  return { version, artifacts }
}

/** Every problem that makes a report unfit to ship (as a signed release, with `requireSigned`). */
export function findProblems(report, { requireSigned }) {
  const problems = []
  for (const artifact of report.artifacts) {
    for (const wanted of artifact.missing) {
      problems.push(`${artifact.name}: does not contain ${wanted}`)
    }
    for (const difference of artifact.payloadDifferences) {
      problems.push(`${artifact.name}: payload differs from the promoted build — ${difference}`)
    }
    if (!requireSigned) continue
    if (!artifact.signed) problems.push(`${artifact.name}: not signed`)
    for (const executable of artifact.executables) {
      if (!executable.signed) problems.push(`${artifact.name}: ${executable.path} is not signed`)
    }
  }
  return problems
}

/** Flat `{ artifact, path, absolute, signed }` rows: each artifact, then what it contains. */
export function flattenExecutables(report) {
  return report.artifacts.flatMap((artifact) => [
    {
      artifact: artifact.name,
      path: artifact.name,
      absolute: artifact.absolute,
      signed: artifact.signed
    },
    ...artifact.executables.map((executable) => ({ artifact: artifact.name, ...executable }))
  ])
}

/** Writes the rows as the JSON the runner-side Authenticode assertion reads. */
export function writeExecutablesReport(path, rows) {
  writeFileSync(path, `${JSON.stringify({ executables: rows }, null, 2)}\n`)
}

/** The rows as a Markdown table for the job summary. */
export function executablesTable(rows) {
  const lines = ['| Artifact | Executable | Authenticode |', '| --- | --- | --- |']
  for (const row of rows) {
    const state = row.signed ? 'signed' : '**not signed**'
    lines.push(`| \`${row.artifact}\` | \`${row.path}\` | ${state} |`)
  }
  return lines.join('\n')
}

async function referenceFromTransport(transport, workDir) {
  const referenceDir = join(workDir, 'reference')
  rmSync(referenceDir, { recursive: true, force: true })
  await sevenZipExtract(transport, referenceDir)
  // build.yml's zip target races the NSIS target's elevate-helper copy, so the
  // archive may or may not contain one; it is not part of the reference.
  rmSync(join(referenceDir, ELEVATE_HELPER), { force: true })
  return snapshotTree(referenceDir)
}

// CLI: node verify-windows-signatures.mjs --dir <dir> --version <v> --work <dir>
//        [--transport <promoted zip>] [--require-signed] [--report <json>] [--markdown <md>]
async function main() {
  const { values } = parseArgs({
    options: {
      dir: { type: 'string' },
      version: { type: 'string' },
      work: { type: 'string' },
      transport: { type: 'string' },
      report: { type: 'string' },
      markdown: { type: 'string' },
      'require-signed': { type: 'boolean', default: false }
    }
  })
  for (const name of ['dir', 'version', 'work']) {
    if (!values[name]) throw new Error(`--${name} is required`)
  }
  const report = await inspectWindowsRelease({
    dir: values.dir,
    version: values.version,
    workDir: values.work,
    reference: values.transport ? await referenceFromTransport(values.transport, values.work) : null
  })
  const rows = flattenExecutables(report)
  for (const row of rows) {
    process.stdout.write(`${row.signed ? 'signed  ' : 'UNSIGNED'}  ${row.artifact} :: ${row.path}\n`)
  }
  if (values.report) writeExecutablesReport(values.report, rows)
  if (values.markdown) writeFileSync(values.markdown, `${executablesTable(rows)}\n`)
  const problems = findProblems(report, { requireSigned: values['require-signed'] })
  if (problems.length > 0) throw new Error(problems.join('\n'))
  process.stdout.write(`Windows artifacts verified: ${rows.length} executable(s) inspected\n`)
}

if (process.argv[1] === import.meta.filename) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error)
    for (const line of message.split('\n')) process.stderr.write(`::error::${line}\n`)
    process.exit(1)
  })
}
