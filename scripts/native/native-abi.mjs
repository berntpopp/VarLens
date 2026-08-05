// Pure helpers for the ABI-keyed native binary cache.
//
// Why this exists: better-sqlite3-multiple-ciphers publishes no prebuild for
// Electron 43's ABI 148 (published range is 121-146), so the Electron binary
// must be compiled from source — 33.6 s. `@electron/rebuild -f` recompiled it
// on every install, dev start and CI job because `-f` defeats the tool's own
// skip logic. We cache the compiled artifact ourselves, keyed by ABI, and
// verify it rather than forcing a rebuild.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'

import { getAbi } from 'node-abi'

export const MODULE_NAME = 'better-sqlite3-multiple-ciphers'
export const REPO_ROOT = resolve(import.meta.dirname, '..', '..')

export const MODULE_BINARY = join(
  REPO_ROOT,
  'node_modules',
  MODULE_NAME,
  'build',
  'Release',
  'better_sqlite3.node'
)

const readJson = (...parts) => JSON.parse(readFileSync(join(REPO_ROOT, ...parts), 'utf8'))

export function electronVersion() {
  return readJson('node_modules', 'electron', 'package.json').version
}

export function moduleVersion() {
  return readJson('node_modules', MODULE_NAME, 'package.json').version
}

export function abiFor(target) {
  if (target === 'node') return process.versions.modules
  if (target === 'electron') return String(getAbi(electronVersion(), 'electron'))
  throw new Error(`unknown target: ${target} (expected 'node' or 'electron')`)
}

// Extracted so it can be unit-tested directly against real Node error text,
// independent of dlopen/subprocess plumbing. Node's own "compiled against a
// different Node.js version" message embeds two numbers: the ABI the binary
// was actually compiled for, and (later in the message) the ABI *this*
// runtime requires. Only the first is the answer we want — this regex must
// not just "match something"; it must anchor on the literal marker so an
// unrelated error full of digits (e.g. a stack trace) returns no match
// rather than a wrong one.
export function parseAbiFromLoadError(message) {
  const match = /NODE_MODULE_VERSION (\d+)/.exec(message)
  return match ? match[1] : null
}

// Independently detects the real ABI of a compiled .node file, without
// trusting any cache manifest and without ever taking down the calling
// process. This closes two holes:
//   - a manifest-only check would pass a binary that matches its own wrong
//     manifest (a poisoned cache entry never gets an independent check);
//   - a truncated `.node` file (an interrupted copy, or ENOSPC mid-write)
//     can carry a perfectly valid header while still being too short to
//     dlopen safely. The dynamic loader then SIGBUSes on a page past the
//     file's real end — a signal, which is not a catchable JS exception.
// Loading the file in a disposable child process sidesteps that entirely:
// if the child dies from a signal, spawnSync reports it as an ordinary
// (non-throwing) `result.signal`, and this process is untouched.
export function detectBinaryAbi(binaryPath) {
  const probe = spawnSync(process.execPath, ['-e', 'require(process.env.VARLENS_PROBE_BINARY)'], {
    env: { ...process.env, VARLENS_PROBE_BINARY: binaryPath },
    stdio: ['ignore', 'ignore', 'pipe']
  })
  if (probe.status === 0) return process.versions.modules

  const stderr = probe.stderr ? probe.stderr.toString() : ''
  const abi = parseAbiFromLoadError(stderr)
  if (abi) return abi

  const reason = probe.signal
    ? `child process was killed by ${probe.signal} while loading the binary ` +
      '(it is likely truncated or corrupt)'
    : (stderr.split('\n').find((line) => /^[A-Za-z]*Error:/.test(line.trim())) ?? '').trim() ||
      probe.error?.message ||
      'unknown load failure'
  throw new Error(`detectBinaryAbi: could not determine ABI of ${binaryPath}: ${reason}`)
}

export function cacheDir(target) {
  return join(
    REPO_ROOT,
    '.cache',
    'native',
    `${process.platform}-${process.arch}-${abiFor(target)}`
  )
}

export const cachedBinary = (target) => join(cacheDir(target), 'better_sqlite3.node')
export const cachedManifest = (target) => join(cacheDir(target), 'manifest.json')

export function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

export function lockfileHash() {
  return sha256(join(REPO_ROOT, 'package-lock.json'))
}

export function buildManifest(target) {
  return {
    target,
    abi: abiFor(target),
    platform: process.platform,
    arch: process.arch,
    electronVersion: target === 'electron' ? electronVersion() : null,
    moduleName: MODULE_NAME,
    moduleVersion: moduleVersion(),
    lockfileHash: lockfileHash(),
    sha256: sha256(MODULE_BINARY)
  }
}

export function readManifest(target) {
  const file = cachedManifest(target)
  if (!existsSync(file)) return null
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

export function manifestIsFresh(target, manifest) {
  if (!manifest) return false
  return (
    manifest.abi === abiFor(target) &&
    manifest.platform === process.platform &&
    manifest.arch === process.arch &&
    manifest.moduleVersion === moduleVersion() &&
    manifest.lockfileHash === lockfileHash()
  )
}

export function store(target) {
  mkdirSync(cacheDir(target), { recursive: true })
  const manifest = buildManifest(target)
  copyFileSync(MODULE_BINARY, cachedBinary(target))
  writeFileSync(cachedManifest(target), `${JSON.stringify(manifest, null, 2)}\n`)
  return manifest
}

export function restore(target) {
  const manifest = readManifest(target)
  if (!manifestIsFresh(target, manifest)) return false
  if (!existsSync(cachedBinary(target))) return false
  if (sha256(cachedBinary(target)) !== manifest.sha256) return false
  mkdirSync(dirname(MODULE_BINARY), { recursive: true })
  copyFileSync(cachedBinary(target), MODULE_BINARY)
  return true
}

// Removes a cached artifact entirely (binary + manifest) so a poisoned entry
// cannot be restored again. `{ force: true }` makes this a no-op rather than
// a throw when there is nothing to remove (missing dir) or a concurrent
// process already cleaned it up.
export function purge(target) {
  rmSync(cacheDir(target), { recursive: true, force: true })
}

// Pure decision for the restore path only: given what detectBinaryAbi found
// for a binary that was just restored from cache, should the caller trust it
// or treat the cache entry as unusable? `detected` is the
// `{ abi, undetermined }` shape a caller gets from wrapping detectBinaryAbi
// in a try/catch (see rebuild-native.mjs's detectOrUndetermined).
//
// Both "detected a different ABI" and "could not determine at all" resolve
// to the same answer here — deliberately, unlike the compile path. A
// restored entry that can't be verified is exactly as unusable as one that's
// verified wrong: a truncated binary with a self-consistent manifest (the
// finding this predicate exists to fix) would otherwise be trusted forever,
// silently wedging the tree while every run reports success. On the restore
// path a recompile is always one step away, so there is no reason to ever
// trust an entry this function can't positively confirm.
export function restoreDecision(detected, expectedAbi) {
  if (!detected.undetermined && detected.abi === expectedAbi) return 'restore'
  return 'purge-and-compile'
}
