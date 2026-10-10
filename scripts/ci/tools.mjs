#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { toolCommand } from './tool-command.mjs'
import { gateEnvironment } from './process.mjs'

const pins = JSON.parse(await readFile(new URL('./tool-versions.json', import.meta.url), 'utf8'))
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

async function downloadArchive(url, { signal } = {}) {
  const response = await fetch(url, {
    signal: AbortSignal.any([AbortSignal.timeout(120_000), ...(signal ? [signal] : [])])
  })
  if (!response.ok) throw new Error(`Tool download failed: HTTP ${response.status}`)
  if (Number(response.headers.get('content-length')) > 128 * 1024 * 1024) {
    throw new Error('Tool download exceeds 128 MiB')
  }
  const chunks = []
  let length = 0
  for await (const chunk of response.body) {
    length += chunk.length
    if (length > 128 * 1024 * 1024) throw new Error('Tool download exceeds 128 MiB')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

async function readOptional(path) {
  try {
    return await readFile(path)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    return undefined
  }
}

async function atomicWrite(path, bytes, executable = false) {
  const directory = await mkdtemp(join(dirname(path), '.install-'))
  const temporary = join(directory, 'payload')
  try {
    await writeFile(temporary, bytes, { mode: executable ? 0o755 : 0o600 })
    await rename(temporary, path)
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
}

/** Archive hashes are committed from the official GitHub release asset SHA-256 digests. */
export function createToolManager(options = {}) {
  const {
    manifest = pins,
    cacheDir = join(homedir(), '.cache', 'varlens-ci', 'tools'),
    platform = process.platform,
    arch = process.arch,
    download = downloadArchive,
    run = toolCommand
  } = options

  async function ensureTool(name, { signal, env } = {}) {
    const spec = manifest[name]
    if (!spec) throw new Error(`Unknown validation tool: ${name}`)
    const asset = spec.assets[`${platform}-${arch}`]
    if (!asset) {
      throw new Error(
        `Unsupported validation host ${platform}-${arch}; use Linux or macOS (Windows: WSL2)`
      )
    }
    signal?.throwIfAborted()
    const directory = resolve(cacheDir, name, spec.version, `${platform}-${arch}`, asset.sha256)
    await mkdir(directory, { recursive: true })
    const archivePath = join(directory, 'archive')
    const existing = await readOptional(archivePath)
    const archive = existing ?? (await download(asset.url, { signal }))
    if (sha256(archive) !== asset.sha256) {
      throw new Error(`${name} archive checksum mismatch; remove ${directory} and retry`)
    }
    if (!existing) await atomicWrite(archivePath, archive)
    // Extract only this member to stdout, never arbitrary archive paths. Rechecking
    // against the archive also detects a corrupt executable or forged local stamp.
    const { stdout: expected } = await run('tar', ['-xOf', archivePath, asset.executable], {
      binary: true,
      env: gateEnvironment(env ?? process.env),
      signal
    })
    if (!expected.length) throw new Error(`${name} archive has an empty executable`)
    const executable = join(directory, basename(asset.executable))
    const actual = await readOptional(executable)
    if (!actual || sha256(actual) !== sha256(expected))
      await atomicWrite(executable, expected, true)
    await chmod(executable, 0o755)
    return executable
  }

  async function runTool(name, args, options = {}) {
    const executable = await ensureTool(name, options)
    const argv = [...args]
    if (name === 'actionlint') {
      argv.unshift('-shellcheck', await ensureTool('shellcheck', options))
    }
    return run(executable, argv, {
      timeout: 15 * 60_000,
      ...options,
      env: gateEnvironment(options.env ?? process.env)
    })
  }

  async function toolFingerprint(options = {}) {
    const identities = {}
    // Sequential extraction bounds peak memory (the Trivy binary is large).
    for (const [name, spec] of Object.entries(manifest)) {
      const executable = await ensureTool(name, options)
      identities[name] = {
        version: spec.version,
        platform,
        arch,
        archiveSha256: spec.assets[`${platform}-${arch}`].sha256,
        executableSha256: sha256(await readFile(executable))
      }
    }
    return identities
  }

  return { cacheDir, ensureTool, runTool, toolFingerprint }
}

const manager = createToolManager()
export const { ensureTool, runTool, toolFingerprint } = manager

const isMain =
  process.argv[1] &&
  (() => {
    try {
      return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
    } catch {
      return false
    }
  })()
if (isMain) {
  const [name, ...args] = process.argv.slice(2)
  try {
    if (name === 'setup') {
      process.stdout.write(`${JSON.stringify(await toolFingerprint(), null, 2)}\n`)
    } else {
      const result = await runTool(name, args)
      process.stdout.write(result.stdout)
      process.stderr.write(result.stderr)
    }
  } catch (error) {
    // Gitleaks callers must pass --redact; never print failed process output here.
    if (name !== 'gitleaks' || args.some((arg) => /^--redact(?:=100)?$/.test(arg))) {
      if (error.stdout) process.stderr.write(error.stdout)
      if (error.stderr) process.stderr.write(error.stderr)
    }
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  }
}
