import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createHash } from 'crypto'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { parseFileEntries, verifyLatestYml } from '../../scripts/release/verify-latest-yml.mjs'

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

interface FileEntryFixture {
  name: string
  body: Buffer
  sha: string
  size: number
}

// Two-entry files: array, shaped exactly like the real, downloaded v0.70.4
// latest-mac.yml (two `- url:`/`sha512:`/`size:` blocks, no blockMapSize —
// that only appears on the Linux AppImage entry, covered separately below).
// Every macOS and Linux release has this multi-entry shape; the single-entry
// writeSet() above never exercises it.
function writeTwoEntrySet(entries: [FileEntryFixture, FileEntryFixture]): string {
  for (const entry of entries) writeFileSync(join(dir, entry.name), entry.body)
  const fileLines = entries.flatMap((entry) => [
    `  - url: ${entry.name}`,
    `    sha512: ${entry.sha}`,
    `    size: ${entry.size}`
  ])
  const yml = [
    'version: 9.9.9',
    'files:',
    ...fileLines,
    `path: ${entries[0].name}`,
    `sha512: ${entries[0].sha}`,
    "releaseDate: '2026-08-06T00:00:00.000Z'"
  ].join('\n')
  const ymlPath = join(dir, 'latest-mac.yml')
  writeFileSync(ymlPath, yml)
  return ymlPath
}

// Copied verbatim from the real v0.70.4 latest-linux.yml release asset
// (`gh release download v0.70.4 -p 'latest*.yml'`). The AppImage entry
// carries an extra `blockMapSize:` line between `size:` and the next
// `- url:` that electron-builder emits for differential-update-capable
// Linux builds; the .deb entry has none, same as the real file.
const REAL_LATEST_LINUX_YML = [
  'version: 0.70.4',
  'files:',
  '  - url: Varlens-0.70.4.AppImage',
  '    sha512: nxtWcGumqh/cJyxhoHPPznIPqbagVoFij4r9CrmOF7OEMBeeu2DqxPzMMLga5Kc+iWBsszW4wjOIV6tYLyofWQ==',
  '    size: 202168940',
  '    blockMapSize: 211584',
  '  - url: Varlens-0.70.4.deb',
  '    sha512: TJ2nDIAOiqZqPo0AwkyMli4bvYtZZk6Yppb/KgMd+rnDPzFNJGvdtTQmFZQgFHBC/4vFuuAz2SuRralm4HHHeQ==',
  '    size: 154097136',
  'path: Varlens-0.70.4.AppImage',
  'sha512: nxtWcGumqh/cJyxhoHPPznIPqbagVoFij4r9CrmOF7OEMBeeu2DqxPzMMLga5Kc+iWBsszW4wjOIV6tYLyofWQ==',
  "releaseDate: '2026-08-06T06:49:16.725Z'"
].join('\n')

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

  it('checks every entry in a multi-entry files array, not just the first — the real two-entry latest-mac.yml shape', () => {
    const zipBody = Buffer.from('signed-zip-bytes')
    const dmgBody = Buffer.from('signed-dmg-bytes')
    const ymlPath = writeTwoEntrySet([
      {
        name: 'Varlens-9.9.9-arm64.zip',
        body: zipBody,
        sha: sha512b64(zipBody),
        size: zipBody.length
      },
      // The SECOND entry is the bad one: its recorded hash is stale even
      // though its size line matches. A parser or checker that stops after
      // entries[0] would pass this vacuously — the first entry alone is
      // fully valid.
      {
        name: 'Varlens-9.9.9-arm64.dmg',
        body: dmgBody,
        sha: sha512b64(Buffer.from('UNSIGNED-dmg-bytes')),
        size: dmgBody.length
      }
    ])
    expect(() => verifyLatestYml({ ymlPath, dir })).toThrow(
      /sha512 mismatch for Varlens-9\.9\.9-arm64\.dmg/i
    )
  })

  it('parses the real latest-linux.yml blockMapSize: line without corrupting the entry or leaking into the next one', () => {
    expect(parseFileEntries(REAL_LATEST_LINUX_YML)).toEqual([
      {
        url: 'Varlens-0.70.4.AppImage',
        sha512:
          'nxtWcGumqh/cJyxhoHPPznIPqbagVoFij4r9CrmOF7OEMBeeu2DqxPzMMLga5Kc+iWBsszW4wjOIV6tYLyofWQ==',
        size: 202168940
      },
      {
        url: 'Varlens-0.70.4.deb',
        sha512:
          'TJ2nDIAOiqZqPo0AwkyMli4bvYtZZk6Yppb/KgMd+rnDPzFNJGvdtTQmFZQgFHBC/4vFuuAz2SuRralm4HHHeQ==',
        size: 154097136
      }
    ])
  })
})
