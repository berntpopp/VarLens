/**
 * ZipExtractor.testPassword must distinguish two failure classes:
 *
 * - The archive itself cannot be opened/parsed (corrupt file, bad format,
 *   truncated data) — an infrastructure fault. This must throw, not be
 *   reported as "wrong password".
 * - The archive opens fine but the given password fails to decrypt the
 *   first entry — the legitimate "wrong password" domain outcome. This
 *   must still return `false`, not throw.
 *
 * Before the fix, both classes were caught by a single try/catch and
 * collapsed into `false`, making a corrupt archive indistinguishable from
 * an incorrect password (finding C8 / Codex F-05).
 */
import { describe, it, expect } from 'vitest'
import AdmZip from 'adm-zip'
import { mkdtempSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomBytes } from 'crypto'
import { ZipExtractor } from '../../../src/main/import/ZipExtractor'

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'varlens-zipextractor-test-'))
}

/** Build a well-formed, unencrypted zip with one small JSON entry. */
function writeValidZip(path: string): void {
  const zip = new AdmZip()
  zip.addFile('case.json', Buffer.from(JSON.stringify({ hello: 'world' })))
  zip.writeZip(path)
}

/**
 * Build a zip whose central directory / local headers parse fine (so
 * `getEntries()` succeeds) but whose compressed entry data is corrupted, so
 * reading it fails with a CRC mismatch — standing in for "data can't be
 * decrypted/decoded with the given input" without needing real ZipCrypto
 * write support (adm-zip does not expose password-protected writes).
 *
 * Uses a large incompressible (random) payload so the local file data region
 * is big and comfortably clear of the central directory/EOCD trailer, then
 * flips bytes squarely in the middle of the whole buffer — safely inside the
 * entry's compressed data, not its header or the trailing directory.
 */
function writeZipWithCorruptEntryData(path: string): void {
  const zip = new AdmZip()
  zip.addFile('case.json', randomBytes(4000))
  const buf = zip.toBuffer()
  const corrupted = Buffer.from(buf)
  const mid = Math.floor(buf.length / 2)
  for (let i = mid; i < mid + 20; i++) {
    corrupted[i] = corrupted[i] ^ 0xff
  }
  writeFileSync(path, corrupted)
}

function writeGarbageFile(path: string): void {
  writeFileSync(path, Buffer.from('this is not a zip file, just plain bytes'))
}

describe('ZipExtractor.testPassword', () => {
  it('throws when the archive itself cannot be opened (corrupt/not a zip)', () => {
    const dir = makeTempDir()
    const garbagePath = join(dir, 'garbage.zip')
    writeGarbageFile(garbagePath)

    const extractor = new ZipExtractor()

    expect(() => extractor.testPassword(garbagePath, 'anypassword')).toThrow()
  })

  it('returns false (not throw) when the archive opens but entry data fails to read — legitimate wrong-password-shaped outcome', () => {
    const dir = makeTempDir()
    const corruptEntryPath = join(dir, 'corrupt-entry.zip')
    writeZipWithCorruptEntryData(corruptEntryPath)

    const extractor = new ZipExtractor()

    let result: boolean | undefined
    expect(() => {
      result = extractor.testPassword(corruptEntryPath, 'anypassword')
    }).not.toThrow()
    expect(result).toBe(false)
  })

  it('preserves the legitimate outcome: a valid, readable archive does not throw', () => {
    const dir = makeTempDir()
    const validPath = join(dir, 'valid.zip')
    writeValidZip(validPath)

    const extractor = new ZipExtractor()

    expect(() => extractor.testPassword(validPath, 'irrelevant')).not.toThrow()
  })
})
