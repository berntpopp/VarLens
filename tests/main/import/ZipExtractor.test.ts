/**
 * ZipExtractor.testPassword must distinguish three outcomes:
 *
 * - The archive itself cannot be opened/parsed (corrupt file, bad format,
 *   truncated data) — an infrastructure fault. This must throw, not be
 *   reported as "wrong password".
 * - The first entry IS encrypted and the given password fails to decrypt
 *   it — the legitimate "wrong password" domain outcome. This must still
 *   return `false`, not throw.
 * - The first entry is NOT encrypted but still fails to read/decode/CRC
 *   check (a corrupt, unencrypted archive) — this is an infrastructure
 *   fault too and must throw, not be reported as "wrong password".
 *
 * Before the first fix, the unopenable-archive and corrupt-entry-data
 * classes were both caught by a single try/catch and collapsed into
 * `false`, making a corrupt archive indistinguishable from an incorrect
 * password (finding C8 / Codex F-05). A follow-up review found the second
 * fix still collapsed a corrupt UNENCRYPTED entry into the same `false`
 * "wrong password" shape as a genuinely encrypted entry with the wrong
 * password — this file now covers both classes explicitly by checking the
 * entry's encryption flag before deciding.
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
 *
 * This entry is NOT encrypted (adm-zip's `header.encrypted` is `false`) —
 * it stands in for a corrupt-but-unencrypted archive.
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

// ── Minimal traditional PKZIP (ZipCrypto) encryption ──────────────────────
//
// adm-zip can DECRYPT ZipCrypto-encrypted entries (used by `getData(pass)`)
// but has no public or internal path to WRITE them — `methods/zipcrypto.js`
// exports an `encrypt` helper that nothing in the library's write pipeline
// ever calls. To build a genuinely encrypted fixture (so `header.encrypted`
// is really `true`, exercising the same code path a real password-protected
// archive would), this reimplements the well-known algorithm directly
// (PKWARE traditional/ZipCrypto stream cipher, keyed by a CRC-32 table) so
// the fixture does not depend on adm-zip's private module layout.

const ZIPCRYPTO_CRC_TABLE = ((): Uint32Array => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c >>> 0
  }
  return table
})()

function makeZipCryptoKeys(password: string): {
  keys: Uint32Array
  update: (byte: number) => void
} {
  const keys = new Uint32Array([0x12345678, 0x23456789, 0x34567890])
  const update = (byte: number): void => {
    keys[0] = ZIPCRYPTO_CRC_TABLE[(keys[0] ^ byte) & 0xff] ^ (keys[0] >>> 8)
    keys[1] = (keys[1] + (keys[0] & 0xff)) >>> 0
    keys[1] = (Math.imul(keys[1], 134775813) + 1) >>> 0
    keys[2] = ZIPCRYPTO_CRC_TABLE[(keys[2] ^ (keys[1] >>> 24)) & 0xff] ^ (keys[2] >>> 8)
  }
  for (const byte of Buffer.from(password)) update(byte)
  return { keys, update }
}

function zipCryptoDecryptByte(keys: Uint32Array): number {
  const temp = (keys[2] | 2) >>> 0
  return (Math.imul(temp, temp ^ 1) >>> 8) & 0xff
}

/**
 * Encrypt `data` (the entry's uncompressed/STORED bytes) with traditional
 * PKZIP encryption under `password`. `crc` is the CRC-32 of the plaintext,
 * used as the salt's verification byte per the ZipCrypto spec. Returns the
 * 12-byte encryption header followed by the encrypted bytes.
 */
function zipCryptoEncrypt(data: Buffer, crc: number, password: string): Buffer {
  const { keys, update } = makeZipCryptoKeys(password)
  const header = Buffer.from(randomBytes(12))
  header[11] = (crc >>> 24) & 0xff

  const out = Buffer.alloc(12 + data.length)
  for (let i = 0; i < 12; i++) {
    const plain = header[i]
    out[i] = plain ^ zipCryptoDecryptByte(keys)
    update(plain)
  }
  for (let i = 0; i < data.length; i++) {
    const plain = data[i]
    out[12 + i] = plain ^ zipCryptoDecryptByte(keys)
    update(plain)
  }
  return out
}

/**
 * Build a genuinely password-protected (ZipCrypto-encrypted) single-entry
 * ZIP archive. Builds an ordinary STORED (uncompressed) zip via adm-zip,
 * then encrypts the entry's data in place and patches the general-purpose
 * "encrypted" flag bit + compressed-size field on both the local file
 * header and the central directory record, plus the EOCD's central
 * directory offset (shifted by the encryption header's 12 extra bytes).
 */
function writeEncryptedZip(
  path: string,
  entryName: string,
  plaintext: string,
  password: string
): void {
  const zip = new AdmZip()
  zip.addFile(entryName, Buffer.from(plaintext))
  const entry = zip.getEntries()[0]
  entry.header.method = 0 // STORED — avoids deflate so the plaintext is byte-identical

  const buf = zip.toBuffer()

  const fnameLen = buf.readUInt16LE(26)
  const extraLen = buf.readUInt16LE(28)
  const localDataOffset = 30 + fnameLen + extraLen
  const compressedSize = buf.readUInt32LE(18)
  const crc = buf.readUInt32LE(14)

  const plainData = buf.subarray(localDataOffset, localDataOffset + compressedSize)
  const encrypted = zipCryptoEncrypt(Buffer.from(plainData), crc, password)
  const delta = encrypted.length - plainData.length

  // Local header + filename + extra, with FLG_ENC (bit 0) set and the
  // compressed-size field updated to the encrypted (12 bytes longer) length.
  const partA = Buffer.from(buf.subarray(0, localDataOffset))
  partA.writeUInt16LE(partA.readUInt16LE(6) | 0x1, 6)
  partA.writeUInt32LE(encrypted.length, 18)

  // Everything after the local file data: central directory + EOCD.
  const partC = Buffer.from(buf.subarray(localDataOffset + compressedSize))
  partC.writeUInt16LE(partC.readUInt16LE(8) | 0x1, 8) // CENFLG |= FLG_ENC
  partC.writeUInt32LE(encrypted.length, 20) // CENSIZ

  const eocdSig = 0x06054b50
  let eocdOffset = -1
  for (let i = 0; i <= partC.length - 4; i++) {
    if (partC.readUInt32LE(i) === eocdSig) {
      eocdOffset = i
      break
    }
  }
  if (eocdOffset === -1) {
    throw new Error('Test fixture builder could not locate the EOCD record')
  }
  const endOff = partC.readUInt32LE(eocdOffset + 16)
  partC.writeUInt32LE(endOff + delta, eocdOffset + 16)

  writeFileSync(path, Buffer.concat([partA, encrypted, partC]))
}

describe('ZipExtractor.testPassword', () => {
  it('throws when the archive itself cannot be opened (corrupt/not a zip)', () => {
    const dir = makeTempDir()
    const garbagePath = join(dir, 'garbage.zip')
    writeGarbageFile(garbagePath)

    const extractor = new ZipExtractor()

    expect(() => extractor.testPassword(garbagePath, 'anypassword')).toThrow()
  })

  it('throws when a NON-encrypted entry fails to read (corrupt archive, not a wrong password)', () => {
    const dir = makeTempDir()
    const corruptEntryPath = join(dir, 'corrupt-entry.zip')
    writeZipWithCorruptEntryData(corruptEntryPath)

    const extractor = new ZipExtractor()

    expect(() => extractor.testPassword(corruptEntryPath, 'anypassword')).toThrow()
  })

  it('returns false (not throw) when an ENCRYPTED entry fails to decrypt with the given password — legitimate wrong-password outcome', () => {
    const dir = makeTempDir()
    const encryptedPath = join(dir, 'encrypted.zip')
    writeEncryptedZip(
      encryptedPath,
      'case.json',
      JSON.stringify({ hello: 'world' }),
      'correct-password'
    )

    const extractor = new ZipExtractor()

    let result: boolean | undefined
    expect(() => {
      result = extractor.testPassword(encryptedPath, 'totally-wrong-password')
    }).not.toThrow()
    expect(result).toBe(false)
  })

  it('returns true for an ENCRYPTED entry when the correct password is given', () => {
    const dir = makeTempDir()
    const encryptedPath = join(dir, 'encrypted-correct.zip')
    writeEncryptedZip(
      encryptedPath,
      'case.json',
      JSON.stringify({ hello: 'world' }),
      'correct-password'
    )

    const extractor = new ZipExtractor()

    expect(extractor.testPassword(encryptedPath, 'correct-password')).toBe(true)
  })

  it('preserves the legitimate outcome: a valid, readable archive does not throw', () => {
    const dir = makeTempDir()
    const validPath = join(dir, 'valid.zip')
    writeValidZip(validPath)

    const extractor = new ZipExtractor()

    expect(() => extractor.testPassword(validPath, 'irrelevant')).not.toThrow()
  })
})
