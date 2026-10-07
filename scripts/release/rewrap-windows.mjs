// Signs every Windows executable of a release and re-wraps the installers
// around the signed app.
//
// build.yml stays the only place the app is built. This script takes the app
// directory build.yml produced for the tagged commit — carried, checksummed,
// in the promoted zip — and:
//
//   1. signs the app executable in that directory;
//   2. runs `electron-builder --prepackaged` over it, which skips the whole
//      pack step (no rebuild, no afterPack, no fuse flip — the fuses and asar
//      integrity resource build.yml wrote are kept as they are) and only
//      builds the NSIS installer and the portable executable, calling the
//      signing hook for the elevate helper, the uninstaller and each installer;
//   3. proves the result: every executable in every artifact is signed, the
//      installed app is build.yml's app file for file, latest.yml describes
//      the final bytes, and exactly the planned number of signatures was spent.
//
// Signing has to happen in this order because each layer embeds the previous
// one: an installer signed first would wrap an unsigned app.
import { spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import process from 'node:process'
import { parseArgs } from 'node:util'

import { verifyLatestYml } from './verify-latest-yml.mjs'
import {
  findProblems,
  flattenExecutables,
  inspectWindowsRelease,
  sevenZipExtract,
  writeExecutablesReport
} from './verify-windows-signatures.mjs'
import { snapshotTree } from './windows-signing/payload.mjs'
import { signatureStrippedDigest } from './windows-signing/pe-signature.mjs'
import { readLedger, signFile } from './windows-signing/sign-file.mjs'
import { createBackend, resolveSigningMode } from './windows-signing/signing-backends.mjs'
import {
  ELEVATE_HELPER,
  planAppSigning,
  publishedWindowsArtifacts,
  ROLES,
  transportArchiveName
} from './windows-signing/signing-plan.mjs'

const PROJECT_DIR = resolve(dirname(import.meta.filename), '..', '..')

/**
 * electron-builder arguments for the re-wrap. `--prepackaged` is what keeps
 * this a re-wrap rather than a rebuild, and `--publish never` keeps
 * electron-builder away from the release; both are load-bearing.
 */
export function electronBuilderArgs({ appDir, outDir }) {
  return [
    '--win',
    'nsis',
    'portable',
    '--x64',
    '--prepackaged',
    appDir,
    '--publish',
    'never',
    `-c.directories.output=${outDir}`
  ]
}

function runElectronBuilder(args, env) {
  const cli = join(PROJECT_DIR, 'node_modules', 'electron-builder', 'cli.js')
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [cli, ...args], {
      cwd: PROJECT_DIR,
      env,
      stdio: 'inherit'
    })
    child.on('error', reject)
    child.on('close', (code) =>
      code === 0 ? resolvePromise() : reject(new Error(`electron-builder exited with code ${code}`))
    )
  })
}

function readPackageVersion() {
  return JSON.parse(readFileSync(join(PROJECT_DIR, 'package.json'), 'utf8')).version
}

async function prepareAppDir({ promotedDir, workDir, version, extract }) {
  const transport = join(promotedDir, transportArchiveName(version))
  if (!existsSync(transport)) {
    throw new Error(`promoted app archive not found: ${transportArchiveName(version)}`)
  }
  const appDir = join(workDir, 'win-unpacked')
  await extract(transport, appDir)
  // The NSIS target copies its own elevate helper in and signs it. build.yml's
  // zip target races that copy, so the archive may or may not hold a stale,
  // unsigned one; drop it so the result does not depend on the race.
  rmSync(join(appDir, ELEVATE_HELPER), { force: true })
  return appDir
}

async function signAppExecutables({ appDir, reference, mode, env, sign }) {
  for (const file of planAppSigning(appDir)) {
    await sign({ file, role: 'app', mode, env })
    const relativePath = relative(appDir, file).split(sep).join('/')
    // Checked straight after the first signature rather than at the end: if a
    // signer ever altered more than the signature, this costs one signature,
    // not five.
    if (`image:${signatureStrippedDigest(file)}` !== reference.get(relativePath)) {
      throw new Error(`signing changed ${relativePath} beyond its signature — refusing to continue`)
    }
  }
}

function stagePublishedArtifacts({ builderOutDir, outDir, version }) {
  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })
  for (const name of publishedWindowsArtifacts(version)) {
    const source = join(builderOutDir, name)
    if (!existsSync(source)) throw new Error(`electron-builder did not produce ${name}`)
    copyFileSync(source, join(outDir, name))
  }
}

function ledgerProblems(ledger) {
  const roles = ledger.signed.map((entry) => entry.role).sort()
  const expected = [...ROLES].sort()
  if (JSON.stringify(roles) === JSON.stringify(expected)) return []
  return [
    `signature ledger does not match the plan: signed [${roles.join(', ')}], ` +
      `planned [${expected.join(', ')}]`
  ]
}

function reportQuota(mode, ledgerFile) {
  const ledger = readLedger(ledgerFile)
  const spent = mode === 'esigner' ? 'spent from the eSigner quota (20/month)' : 'no quota used'
  process.stdout.write(
    `::notice title=Windows code signing::${mode}: ${ledger.signed.length} signature(s) ` +
      `in ${ledger.attempts} attempt(s) — ${spent}\n`
  )
}

/**
 * Runs the whole sign-and-re-wrap for one release. Leaves exactly the
 * published Windows artifact set in `outDir` and resolves with the
 * verification report; throws if anything is unsigned, altered or unplanned.
 */
export async function rewrapWindows({
  promotedDir,
  outDir,
  workDir,
  version,
  env = process.env,
  deps = {}
}) {
  const {
    extract = sevenZipExtract,
    runBuilder = runElectronBuilder,
    sign = signFile,
    packageVersion = readPackageVersion
  } = deps
  const mode = resolveSigningMode(env)
  if (mode === 'off') {
    throw new Error('VARLENS_WINDOWS_SIGNING is off — there is nothing to re-wrap without signing')
  }
  // Everything that can fail for free fails here, before the first signature.
  if (packageVersion() !== version) {
    throw new Error(`package.json is ${packageVersion()} but the release is ${version}`)
  }
  if (!deps.sign) createBackend(mode, { env })

  rmSync(workDir, { recursive: true, force: true })
  mkdirSync(workDir, { recursive: true })
  const ledgerFile = join(workDir, 'signing-ledger.json')
  const signingEnv = {
    ...env,
    VARLENS_WINDOWS_SIGN_LEDGER: ledgerFile,
    VARLENS_WINDOWS_SIGN_VERSION: version
  }
  try {
    const appDir = await prepareAppDir({ promotedDir, workDir, version, extract })
    const reference = await snapshotTree(appDir)
    await signAppExecutables({ appDir, reference, mode, env: signingEnv, sign })

    const builderOutDir = join(workDir, 'electron-builder')
    await runBuilder(electronBuilderArgs({ appDir, outDir: builderOutDir }), signingEnv)
    stagePublishedArtifacts({ builderOutDir, outDir, version })

    verifyLatestYml({ ymlPath: join(outDir, 'latest.yml'), dir: outDir })
    const report = await inspectWindowsRelease({
      dir: outDir,
      version,
      workDir: join(workDir, 'verify'),
      extract,
      reference
    })
    const problems = [
      ...findProblems(report, { requireSigned: true }),
      ...ledgerProblems(readLedger(ledgerFile))
    ]
    if (problems.length > 0) throw new Error(problems.join('\n'))
    return { mode, report, executables: flattenExecutables(report) }
  } finally {
    reportQuota(mode, ledgerFile)
  }
}

// CLI: node rewrap-windows.mjs --promoted <dir> --out <dir> --work <dir> --version <v>
//        [--report <json>]
async function main() {
  const { values } = parseArgs({
    options: {
      promoted: { type: 'string' },
      out: { type: 'string' },
      work: { type: 'string' },
      version: { type: 'string' },
      report: { type: 'string' }
    }
  })
  for (const name of ['promoted', 'out', 'work', 'version']) {
    if (!values[name]) throw new Error(`--${name} is required`)
  }
  const { mode, executables } = await rewrapWindows({
    promotedDir: resolve(values.promoted),
    outDir: resolve(values.out),
    workDir: resolve(values.work),
    version: values.version
  })
  for (const row of executables) {
    process.stdout.write(`signed  ${row.artifact} :: ${row.path}\n`)
  }
  if (values.report) writeExecutablesReport(resolve(values.report), executables)
  process.stdout.write(`Windows release re-wrapped and verified (${mode})\n`)
}

if (process.argv[1] === import.meta.filename) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error)
    for (const line of message.split('\n')) process.stderr.write(`::error::${line}\n`)
    process.exit(1)
  })
}
