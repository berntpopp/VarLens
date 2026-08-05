import { readFileSync } from 'fs'
import { resolve } from 'path'

import { getAbi } from 'node-abi'
import { describe, expect, test } from 'vitest'

import {
  MODULE_NAME,
  abiFor,
  cacheDir,
  electronVersion,
  lockfileHash,
  manifestIsFresh,
  moduleVersion
} from '../../scripts/native/native-abi.mjs'

const ROOT = resolve(__dirname, '..', '..')

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
})
