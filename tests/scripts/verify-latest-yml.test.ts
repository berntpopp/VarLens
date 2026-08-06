import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createHash } from 'crypto'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { verifyLatestYml } from '../../scripts/release/verify-latest-yml.mjs'

let dir: string
const sha512b64 = (buf: Buffer): string => createHash('sha512').update(buf).digest('base64')

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'varlens-latestyml-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function writeSet(bodyText: string, ymlSha: string, ymlSize: number): string {
  const body = Buffer.from(bodyText)
  writeFileSync(join(dir, 'Varlens-Setup-9.9.9.exe'), body)
  const yml = [
    'version: 9.9.9',
    'files:',
    '  - url: Varlens-Setup-9.9.9.exe',
    `    sha512: ${ymlSha}`,
    `    size: ${ymlSize}`,
    'path: Varlens-Setup-9.9.9.exe',
    `sha512: ${ymlSha}`,
    'releaseDate: 2026-08-06T00:00:00.000Z'
  ].join('\n')
  const ymlPath = join(dir, 'latest.yml')
  writeFileSync(ymlPath, yml)
  return ymlPath
}

describe('verifyLatestYml', () => {
  it('accepts metadata whose hash and size match the file on disk', () => {
    const body = Buffer.from('signed-installer-bytes')
    const ymlPath = writeSet('signed-installer-bytes', sha512b64(body), body.length)
    expect(verifyLatestYml({ ymlPath, dir })).toEqual({
      ok: true,
      checked: ['Varlens-Setup-9.9.9.exe']
    })
  })

  it('rejects metadata describing the pre-signing bytes — the regex-no-op failure', () => {
    const stale = Buffer.from('UNSIGNED-installer-bytes')
    const signed = Buffer.from('signed-installer-bytes')
    // yml still carries the unsigned hash; disk carries the signed file.
    const ymlPath = writeSet('signed-installer-bytes', sha512b64(stale), signed.length)
    expect(() => verifyLatestYml({ ymlPath, dir })).toThrow(/sha512 mismatch/i)
  })

  it('rejects a stale size even when the hash was updated', () => {
    const body = Buffer.from('signed-installer-bytes')
    const ymlPath = writeSet('signed-installer-bytes', sha512b64(body), body.length + 4096)
    expect(() => verifyLatestYml({ ymlPath, dir })).toThrow(/size mismatch/i)
  })

  it('rejects metadata referencing a file that is not there', () => {
    const body = Buffer.from('x')
    const ymlPath = writeSet('x', sha512b64(body), body.length)
    rmSync(join(dir, 'Varlens-Setup-9.9.9.exe'))
    expect(() => verifyLatestYml({ ymlPath, dir })).toThrow(/not found/i)
  })

  it('refuses to pass when the files array is empty, rather than vacuously succeeding', () => {
    const ymlPath = join(dir, 'latest.yml')
    writeFileSync(ymlPath, 'version: 9.9.9\nfiles:\n')
    expect(() => verifyLatestYml({ ymlPath, dir })).toThrow(/no files/i)
  })
})
