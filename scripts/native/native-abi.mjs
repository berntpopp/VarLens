// Pure helpers for the ABI-keyed native binary cache.
//
// Why this exists: better-sqlite3-multiple-ciphers publishes no prebuild for
// Electron 43's ABI 148 (published range is 121-146), so the Electron binary
// must be compiled from source — 33.6 s. `@electron/rebuild -f` recompiled it
// on every install, dev start and CI job because `-f` defeats the tool's own
// skip logic. We cache the compiled artifact ourselves, keyed by ABI, and
// verify it rather than forcing a rebuild.
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
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

// Independently detects the real ABI of a compiled .node file, without
// trusting any cache manifest. This closes the hole where `store()` would
// otherwise record "whatever is on disk" under the wrong target: if
// `@electron/rebuild` silently skips a compile while the tree is actually on
// the Node ABI, a manifest-only check would pass because the wrong binary
// matches its own wrong manifest.
//
// Loading a .node file under this Node process either succeeds (it is this
// process's ABI) or throws an error whose message embeds the file's real
// ABI, e.g. "NODE_MODULE_VERSION 148. This version of Node.js requires
// NODE_MODULE_VERSION 137." The first number in that message is the ABI the
// binary was actually built for.
export function detectBinaryAbi(binaryPath) {
  try {
    createRequire(import.meta.url)(binaryPath)
    return process.versions.modules
  } catch (error) {
    const match = /NODE_MODULE_VERSION (\d+)/.exec(error.message)
    if (match) return match[1]
    throw new Error(`detectBinaryAbi: could not determine ABI of ${binaryPath}: ${error.message}`, {
      cause: error
    })
  }
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
