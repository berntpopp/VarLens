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
import { mkdtempSync, readFileSync, writeFileSync } from 'fs'
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
  password: string,
  plainFirst = false
): void {
  const zip = new AdmZip()
  if (plainFirst) {
    zip.addFile('plain.json', Buffer.from('{"plain":true}'))
  }
  zip.addFile(entryName, Buffer.from(plaintext))
  for (const entry of zip.getEntries()) {
    entry.header.method = 0 // STORED — plaintext is byte-identical before encryption
  }

  const buf = zip.toBuffer()
  const local = findLocalEntry(buf, entryName)
  const compressedSize = local.compressedSize
  const crc = buf.readUInt32LE(local.headerOffset + 14)

  const plainData = buf.subarray(local.dataOffset, local.dataOffset + compressedSize)
  const encrypted = zipCryptoEncrypt(Buffer.from(plainData), crc, password)
  const delta = encrypted.length - plainData.length

  const partA = Buffer.from(buf.subarray(0, local.dataOffset))
  partA.writeUInt16LE(partA.readUInt16LE(local.headerOffset + 6) | 0x1, local.headerOffset + 6)
  partA.writeUInt32LE(encrypted.length, local.headerOffset + 18)

  // Everything after the local file data: central directory + EOCD.
  const originalDataEnd = local.dataOffset + compressedSize
  const partC = Buffer.from(buf.subarray(originalDataEnd))
  const centralOffset = findCentralEntry(buf, entryName) - originalDataEnd
  partC.writeUInt16LE(partC.readUInt16LE(centralOffset + 8) | 0x1, centralOffset + 8)
  partC.writeUInt32LE(encrypted.length, centralOffset + 20)

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

interface LocalZipEntry {
  headerOffset: number
  dataOffset: number
  compressedSize: number
}

function findLocalEntry(buf: Buffer, entryName: string): LocalZipEntry {
  let offset = 0
  while (offset + 30 <= buf.length && buf.readUInt32LE(offset) === 0x04034b50) {
    const compressedSize = buf.readUInt32LE(offset + 18)
    const nameLength = buf.readUInt16LE(offset + 26)
    const extraLength = buf.readUInt16LE(offset + 28)
    const name = buf.subarray(offset + 30, offset + 30 + nameLength).toString('utf8')
    const dataOffset = offset + 30 + nameLength + extraLength
    if (name === entryName) return { headerOffset: offset, dataOffset, compressedSize }
    offset = dataOffset + compressedSize
  }
  throw new Error(`Test fixture builder could not find local entry ${entryName}`)
}

function findCentralEntry(buf: Buffer, entryName: string): number {
  const eocdOffset = findSignatureFromEnd(buf, 0x06054b50)
  let offset = buf.readUInt32LE(eocdOffset + 16)
  while (offset + 46 <= eocdOffset && buf.readUInt32LE(offset) === 0x02014b50) {
    const nameLength = buf.readUInt16LE(offset + 28)
    const extraLength = buf.readUInt16LE(offset + 30)
    const commentLength = buf.readUInt16LE(offset + 32)
    const name = buf.subarray(offset + 46, offset + 46 + nameLength).toString('utf8')
    if (name === entryName) return offset
    offset += 46 + nameLength + extraLength + commentLength
  }
  throw new Error(`Test fixture builder could not find central entry ${entryName}`)
}

function findSignatureFromEnd(buf: Buffer, signature: number): number {
  for (let offset = buf.length - 4; offset >= 0; offset--) {
    if (buf.readUInt32LE(offset) === signature) return offset
  }
  throw new Error(`Test fixture builder could not find ZIP signature ${signature.toString(16)}`)
}

function corruptEncryptedPayload(path: string, entryName: string): void {
  const buf = readFileSync(path)
  const local = findLocalEntry(buf, entryName)
  const corrupted = Buffer.from(buf)
  const payloadOffset = local.dataOffset + 12 + Math.floor((local.compressedSize - 12) / 2)
  corrupted[payloadOffset] ^= 0xff
  writeFileSync(path, corrupted)
}

describe('ZipExtractor.testPassword', () => {
  it('does not classify an unreadable archive as unencrypted', () => {
    const dir = makeTempDir()
    const garbagePath = join(dir, 'garbage-encryption-check.zip')
    writeGarbageFile(garbagePath)

    const extractor = new ZipExtractor()
    expect(() => extractor.isEncrypted(garbagePath)).toThrow(/ZIP archive/i)
  })

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

  it('throws for corrupt encrypted data even when the password is correct', () => {
    const dir = makeTempDir()
    const encryptedPath = join(dir, 'encrypted-corrupt.zip')
    writeEncryptedZip(
      encryptedPath,
      'case.json',
      JSON.stringify({ hello: 'world' }),
      'correct-password'
    )
    corruptEncryptedPayload(encryptedPath, 'case.json')

    const extractor = new ZipExtractor()
    expect(() => extractor.testPassword(encryptedPath, 'correct-password')).toThrow(/corrupt/i)
  })

  it('checks every encrypted entry when an unencrypted file appears first', () => {
    const dir = makeTempDir()
    const encryptedPath = join(dir, 'mixed.zip')
    writeEncryptedZip(
      encryptedPath,
      'secret.json',
      JSON.stringify({ secret: true }),
      'correct-password',
      true
    )

    const extractor = new ZipExtractor()
    expect(extractor.testPassword(encryptedPath, 'wrong-password')).toBe(false)
  })

  it('preserves the legitimate outcome: a valid, readable archive does not throw', () => {
    const dir = makeTempDir()
    const validPath = join(dir, 'valid.zip')
    writeValidZip(validPath)

    const extractor = new ZipExtractor()

    expect(() => extractor.testPassword(validPath, 'irrelevant')).not.toThrow()
  })
})
