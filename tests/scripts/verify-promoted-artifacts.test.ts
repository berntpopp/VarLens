import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'fs'
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
    writeValidSet()
    writeFileSync(join(dir, 'SHA256SUMS'), `${sha256(Buffer.from('x'))}  nope.bin\n`)
    expect(() =>
      verifyPromotedArtifacts({ dir, platform: 'linux', version: VERSION, sha: SHA })
    ).toThrow(/not listed in SHA256SUMS|checksum mismatch|missing/i)
  })
})
