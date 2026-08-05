import { mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'

import { getAbi } from 'node-abi'
import { describe, expect, test } from 'vitest'

import {
  MODULE_BINARY,
  MODULE_NAME,
  abiFor,
  cacheDir,
  detectBinaryAbi,
  electronVersion,
  lockfileHash,
  manifestIsFresh,
  moduleVersion,
  parseAbiFromLoadError
} from '../../scripts/native/native-abi.mjs'

const ROOT = resolve(__dirname, '..', '..')

// Captured verbatim from requiring an ABI-148 binary under this Node's ABI
// 137 runtime (see scripts/native/rebuild-native.mjs's report for how it was
// produced). This is the exact shape parseAbiFromLoadError has to parse —
// the regex must pull out 148 (what the binary was compiled for), not 137
// (what this runtime happens to require).
const REAL_NODE_ABI_MISMATCH_MESSAGE =
  "The module '/repo/.cache/native/linux-x64-148/better_sqlite3.node'\n" +
  'was compiled against a different Node.js version using\n' +
  'NODE_MODULE_VERSION 148. This version of Node.js requires\n' +
  'NODE_MODULE_VERSION 137. Please try re-compiling or re-installing\n' +
  'the module (for instance, using `npm rebuild` or `npm install`).'

describe('native ABI helpers', () => {
  test('targets the encrypted sqlite module', () => {
    expect(MODULE_NAME).toBe('better-sqlite3-multiple-ciphers')
  })

  test('node target ABI is this runtime ABI', () => {
    expect(abiFor('node')).toBe(process.versions.modules)
  })

  test('electron target ABI is derived from the installed electron, not hardcoded', () => {
    const installed = electronVersion()
    const pinned = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')).devDependencies
      .electron
    expect(pinned).toContain(installed.split('.')[0])
    expect(abiFor('electron')).toBe(String(getAbi(installed, 'electron')))
  })

  test('node and electron ABIs differ, which is why two binaries are needed', () => {
    expect(abiFor('electron')).not.toBe(abiFor('node'))
  })

  test('rejects an unknown target rather than guessing', () => {
    expect(() => abiFor('deno')).toThrow(/unknown target/i)
  })

  test('cache dir is keyed by platform, arch and ABI', () => {
    const dir = cacheDir('electron')
    expect(dir).toContain(`${process.platform}-${process.arch}-${abiFor('electron')}`)
    expect(dir).toContain('.cache')
  })

  test('a manifest is fresh when every identifying field matches the live values', () => {
    const fresh = {
      abi: abiFor('electron'),
      platform: process.platform,
      arch: process.arch,
      moduleVersion: moduleVersion(),
      lockfileHash: lockfileHash()
    }
    expect(manifestIsFresh('electron', fresh)).toBe(true)
  })

  test('a manifest is stale when anything identifying the artifact differs', () => {
    const fresh = {
      abi: abiFor('electron'),
      platform: process.platform,
      arch: process.arch,
      moduleVersion: moduleVersion(),
      lockfileHash: 'deadbeef'
    }
    expect(manifestIsFresh('electron', null)).toBe(false)
    expect(manifestIsFresh('electron', { ...fresh, lockfileHash: 'deadbeef' })).toBe(false)
    expect(manifestIsFresh('electron', { ...fresh, abi: '1' })).toBe(false)
    expect(manifestIsFresh('electron', { ...fresh, moduleVersion: '0.0.0' })).toBe(false)
  })

  describe('parseAbiFromLoadError', () => {
    test('extracts the ABI the binary was actually compiled for, not the one this runtime requires', () => {
      // The message contains two NODE_MODULE_VERSION numbers. 148 (first) is
      // the binary's real ABI — the answer this function exists to produce.
      // 137 (second) is what *this* runtime requires, which is a different
      // question and must not be what gets returned.
      expect(parseAbiFromLoadError(REAL_NODE_ABI_MISMATCH_MESSAGE)).toBe('148')
    })

    test('does not match unrelated errors that merely contain digits', () => {
      // Guards against a regex broad enough to match "something", which
      // would make it worse than useless as an ABI-mismatch detector.
      expect(
        parseAbiFromLoadError("Error: Cannot find module '/nonexistent/path/foo.node'")
      ).toBeNull()
      expect(parseAbiFromLoadError('Segmentation fault (core dumped), code 139')).toBeNull()
    })
  })

  test('detectBinaryAbi reports this runtime ABI for the currently-installed binary', () => {
    // Tests run under the Node ABI (see AGENTS.md's dual-rebuild gotcha), so
    // the binary that is actually on disk right now must load here and
    // report process.versions.modules — independent of any cache manifest.
    expect(detectBinaryAbi(MODULE_BINARY)).toBe(process.versions.modules)
  })

  test('detectBinaryAbi throws with a clear reason rather than guessing when the file does not exist', () => {
    expect(() => detectBinaryAbi(resolve(ROOT, 'does', 'not', 'exist.node'))).toThrow(
      /could not determine ABI/
    )
  })

  test('detectBinaryAbi throws (does not crash the process) for a truncated binary', () => {
    // Reproduces the real defect: a binary with a valid header but cut off
    // partway through can SIGBUS the dynamic loader on dlopen — a signal,
    // not a catchable JS exception. detectBinaryAbi probes in a disposable
    // child process specifically so this test (and any real caller) survives
    // that instead of taking the whole process down with it.
    const dir = mkdtempSync(join(tmpdir(), 'varlens-native-abi-test-'))
    const truncated = join(dir, 'truncated.node')
    const wholeBinary = readFileSync(MODULE_BINARY)
    writeFileSync(truncated, wholeBinary.subarray(0, Math.floor(wholeBinary.length * 0.6)))

    expect(() => detectBinaryAbi(truncated)).toThrow(/could not determine ABI/)
  })
})
