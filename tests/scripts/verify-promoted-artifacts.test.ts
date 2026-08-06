import { mkdtempSync, writeFileSync, rmSync, mkdirSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createHash } from 'crypto'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { verifyPromotedArtifacts } from '../../scripts/release/verify-promoted-artifacts.mjs'

const VERSION = '9.9.9'
const SHA = 'a'.repeat(40)

let dir: string

const sha256 = (buf: Buffer): string => createHash('sha256').update(buf).digest('hex')

/** Write a complete, valid linux artifact set. Tests then corrupt one thing at a time. */
function writeValidSet(): void {
  const files = [`Varlens-${VERSION}.AppImage`, `Varlens-${VERSION}.deb`, 'latest-linux.yml']
  const sums: string[] = []
  for (const name of files) {
    const body = Buffer.from(`payload-${name}`)
    writeFileSync(join(dir, name), body)
    sums.push(`${sha256(body)}  ${name}`)
  }
  writeFileSync(join(dir, 'SHA256SUMS'), sums.join('\n') + '\n')
  writeFileSync(
    join(dir, 'provenance.json'),
    JSON.stringify({ sha: SHA, version: VERSION, os: 'ubuntu-latest', platform: 'linux' })
  )
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'varlens-promote-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('verifyPromotedArtifacts', () => {
  it('accepts a complete, self-consistent artifact set', () => {
    writeValidSet()
    expect(verifyPromotedArtifacts({ dir, platform: 'linux', version: VERSION, sha: SHA })).toEqual(
      {
        ok: true
      }
    )
  })

  it('rejects a set whose provenance names a different commit', () => {
    writeValidSet()
    writeFileSync(
      join(dir, 'provenance.json'),
      JSON.stringify({ sha: 'b'.repeat(40), version: VERSION })
    )
    expect(() =>
      verifyPromotedArtifacts({ dir, platform: 'linux', version: VERSION, sha: SHA })
    ).toThrow(/provenance sha/i)
  })

  it('rejects a set whose provenance names a different version', () => {
    writeValidSet()
    writeFileSync(join(dir, 'provenance.json'), JSON.stringify({ sha: SHA, version: '0.0.1' }))
    expect(() =>
      verifyPromotedArtifacts({ dir, platform: 'linux', version: VERSION, sha: SHA })
    ).toThrow(/provenance version/i)
  })

  it('rejects a tampered payload whose checksum no longer matches', () => {
    writeValidSet()
    writeFileSync(join(dir, `Varlens-${VERSION}.deb`), Buffer.from('tampered'))
    expect(() =>
      verifyPromotedArtifacts({ dir, platform: 'linux', version: VERSION, sha: SHA })
    ).toThrow(/checksum mismatch/i)
  })

  it('rejects a set missing a required asset', () => {
    writeValidSet()
    rmSync(join(dir, 'latest-linux.yml'))
    expect(() =>
      verifyPromotedArtifacts({ dir, platform: 'linux', version: VERSION, sha: SHA })
    ).toThrow(/missing expected artifact.*latest-linux\.yml/i)
  })

  it('rejects an entirely empty directory rather than passing vacuously', () => {
    mkdirSync(join(dir, 'empty'), { recursive: true })
    expect(() =>
      verifyPromotedArtifacts({
        dir: join(dir, 'empty'),
        platform: 'linux',
        version: VERSION,
        sha: SHA
      })
    ).toThrow(/provenance\.json/i)
  })

  it('rejects a SHA256SUMS that omits a file present on disk', () => {
    // Tightened to a genuine single-file omission (the original body
    // replaced SHA256SUMS wholesale, omitting all three files at once,
    // which didn't match what the test name claimed). Drop only the .deb
    // entry; the AppImage and latest-linux.yml entries stay intact.
    writeValidSet()
    const debName = `Varlens-${VERSION}.deb`
    const remaining = readFileSync(join(dir, 'SHA256SUMS'), 'utf8')
      .trim()
      .split('\n')
      .filter((line) => !line.includes(debName))
    writeFileSync(join(dir, 'SHA256SUMS'), remaining.join('\n') + '\n')
    expect(() =>
      verifyPromotedArtifacts({ dir, platform: 'linux', version: VERSION, sha: SHA })
    ).toThrow(/not listed in SHA256SUMS/i)
  })

  it('rejects a superset: an extra file present on disk and correctly checksummed in SHA256SUMS, but not in the expected artifact set', () => {
    // Regression for the critical finding: Task 6's upload step re-globs
    // promoted/<plat>/*.<ext> rather than reading SHA256SUMS, so a planted
    // file that is present, checksummed, and self-consistent would still
    // reach a published release unless this is checked as an exact set.
    writeValidSet()
    const evilName = `Varlens-${VERSION}-EVIL-backdoor.exe`
    const evilBody = Buffer.from('evil-payload')
    writeFileSync(join(dir, evilName), evilBody)
    const existingSums = readFileSync(join(dir, 'SHA256SUMS'), 'utf8')
    writeFileSync(join(dir, 'SHA256SUMS'), `${existingSums}${sha256(evilBody)}  ${evilName}\n`)
    expect(() =>
      verifyPromotedArtifacts({ dir, platform: 'linux', version: VERSION, sha: SHA })
    ).toThrow(/unexpected/i)
  })

  it('rejects a phantom SHA256SUMS entry for a file that was never written to disk', () => {
    // Covers the checksum-entries check independently of the on-disk check:
    // no extra file exists here, only an extra checksum line naming one that
    // was never produced. SHA256SUMS must accurately describe what shipped.
    writeValidSet()
    const existingSums = readFileSync(join(dir, 'SHA256SUMS'), 'utf8')
    writeFileSync(
      join(dir, 'SHA256SUMS'),
      `${existingSums}${sha256(Buffer.from('phantom'))}  Varlens-${VERSION}-phantom.exe\n`
    )
    expect(() =>
      verifyPromotedArtifacts({ dir, platform: 'linux', version: VERSION, sha: SHA })
    ).toThrow(/unexpected entry in SHA256SUMS/i)
  })
})
