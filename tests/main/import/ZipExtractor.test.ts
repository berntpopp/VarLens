/**
 * ZipExtractor.testPassword must distinguish three outcomes:
 *
 * - The archive itself cannot be opened/parsed (corrupt file, bad format,
 *   truncated data) — an infrastructure fault. This must throw, not be
 *   reported as "wrong password".
 * - An encrypted entry rejects the given password — the legitimate "wrong
 *   password" domain outcome. Validation must continue through later entries
 *   before returning `false`, so ordering cannot hide corruption.
 * - A non-password read/decode/CRC failure is an infrastructure fault and
 *   must throw, whether its entry is encrypted or not.
 * - A readable archive without encrypted entries returns `false`; success
 *   requires at least one encrypted entry and a password accepted by all of
 *   them.
 *
 * Before the first fix, the unopenable-archive and corrupt-entry-data
 * classes were both caught by a single try/catch and collapsed into
 * `false`, making a corrupt archive indistinguishable from an incorrect
 * password (finding C8 / Codex F-05). A follow-up review found the second
 * fix still collapsed a corrupt UNENCRYPTED entry into the same `false`
 * "wrong password" shape as a genuinely encrypted entry with the wrong
 * password. A later review found password rejection also returned early and
 * could hide corruption in subsequent entries. This file locks all outcomes.
 */
import { afterEach, describe, it, expect, vi } from 'vitest'
import AdmZip from 'adm-zip'
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'fs'
import { basename, dirname, join } from 'path'
import { tmpdir } from 'os'
import { randomBytes } from 'crypto'
import { ZipExtractor } from '../../../src/main/import/ZipExtractor'
import { findLocalEntry, writeEncryptedZip } from '../../utils/zip-fixtures'
import { mainLogger } from '../../../src/main/services/MainLogger'

afterEach(() => {
  vi.restoreAllMocks()
})

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

function makeStubArchive(
  entries: Array<{
    entryName: string
    encrypted: boolean
    declaredSize: number
    getData: (password: string) => Buffer
  }>
): { zipPath: string; openArchive: () => AdmZip } {
  const dir = makeTempDir()
  const zipPath = join(dir, 'stub-source.zip')
  writeValidZip(zipPath)
  const zipEntries = entries.map(
    ({ entryName, encrypted, declaredSize, getData }) =>
      ({
        entryName,
        isDirectory: false,
        header: { encrypted, size: declaredSize },
        getData
      }) as unknown as AdmZip.IZipEntry
  )

  return {
    zipPath,
    openArchive: () => ({ getEntries: () => zipEntries }) as unknown as AdmZip
  }
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

  it('continues after a wrong-password result and throws when a later entry is corrupt', () => {
    const wrongPasswordRead = vi.fn(() => {
      throw new Error('Wrong Password')
    })
    const corruptRead = vi.fn(() => {
      throw new Error('CRC mismatch')
    })
    const { zipPath, openArchive } = makeStubArchive([
      {
        entryName: 'first.json',
        encrypted: true,
        declaredSize: 2,
        getData: wrongPasswordRead
      },
      {
        entryName: 'second.json',
        encrypted: true,
        declaredSize: 2,
        getData: corruptRead
      }
    ])

    const extractor = new ZipExtractor(undefined, openArchive)

    expect(() => extractor.testPassword(zipPath, 'wrong')).toThrow(/corrupt/i)
    expect(wrongPasswordRead).toHaveBeenCalledOnce()
    expect(corruptRead).toHaveBeenCalledOnce()
  })

  it('checks later encrypted entries before returning the aggregated wrong-password result', () => {
    const wrongPasswordRead = vi.fn(() => {
      throw new Error('Wrong Password')
    })
    const successfulRead = vi.fn(() => Buffer.from('{}'))
    const { zipPath, openArchive } = makeStubArchive([
      {
        entryName: 'first.json',
        encrypted: true,
        declaredSize: 2,
        getData: wrongPasswordRead
      },
      {
        entryName: 'second.json',
        encrypted: true,
        declaredSize: 2,
        getData: successfulRead
      }
    ])

    const extractor = new ZipExtractor(undefined, openArchive)

    expect(extractor.testPassword(zipPath, 'wrong')).toBe(false)
    expect(wrongPasswordRead).toHaveBeenCalledOnce()
    expect(successfulRead).toHaveBeenCalledOnce()
  })

  it('returns false when no encrypted entry exists', () => {
    const dir = makeTempDir()
    const validPath = join(dir, 'valid.zip')
    writeValidZip(validPath)

    const extractor = new ZipExtractor()

    expect(extractor.testPassword(validPath, 'irrelevant')).toBe(false)
  })

  it('rejects a declared entry size above the password-validation limit before decoding', () => {
    const getData = vi.fn(() => Buffer.alloc(5))
    const { zipPath, openArchive } = makeStubArchive([
      { entryName: 'large.json', encrypted: true, declaredSize: 5, getData }
    ])

    const extractor = new ZipExtractor(
      {
        maxEntryUncompressedBytes: 4,
        maxTotalUncompressedBytes: 10
      },
      openArchive
    )

    expect(() => extractor.testPassword(zipPath, 'secret')).toThrow(/limit/i)
    expect(getData).not.toHaveBeenCalled()
  })

  it('rejects actual decoded data above the declared per-entry limit', () => {
    const getData = vi.fn(() => Buffer.alloc(5))
    const { zipPath, openArchive } = makeStubArchive([
      { entryName: 'lying-header.json', encrypted: true, declaredSize: 1, getData }
    ])

    const extractor = new ZipExtractor(
      {
        maxEntryUncompressedBytes: 4,
        maxTotalUncompressedBytes: 10
      },
      openArchive
    )

    expect(() => extractor.testPassword(zipPath, 'secret')).toThrow(/limit/i)
    expect(getData).toHaveBeenCalledOnce()
  })

  it('rejects entries whose cumulative declared size exceeds the validation limit', () => {
    const firstRead = vi.fn(() => Buffer.alloc(4))
    const secondRead = vi.fn(() => Buffer.alloc(4))
    const { zipPath, openArchive } = makeStubArchive([
      { entryName: 'first.json', encrypted: true, declaredSize: 4, getData: firstRead },
      { entryName: 'second.json', encrypted: true, declaredSize: 4, getData: secondRead }
    ])

    const extractor = new ZipExtractor(
      {
        maxEntryUncompressedBytes: 5,
        maxTotalUncompressedBytes: 6
      },
      openArchive
    )

    expect(() => extractor.testPassword(zipPath, 'secret')).toThrow(/limit/i)
    expect(firstRead).toHaveBeenCalledOnce()
    expect(secondRead).not.toHaveBeenCalled()
  })

  it('does not expose the supplied password through corruption errors or logs', () => {
    const password = 'sentinel-password-never-log'
    const getData = vi.fn(() => {
      throw new Error(`CRC mismatch while using ${password}`)
    })
    const { zipPath, openArchive } = makeStubArchive([
      { entryName: 'corrupt.json', encrypted: true, declaredSize: 2, getData }
    ])
    const errorSpy = vi.spyOn(mainLogger, 'error').mockImplementation(() => undefined)
    const extractor = new ZipExtractor(undefined, openArchive)

    let thrown: unknown
    try {
      extractor.testPassword(zipPath, password)
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(Error)
    expect(String(thrown)).not.toContain(password)
    expect(String((thrown as Error).cause)).not.toContain(password)
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(password)
  })
})

describe('ZipExtractor.extract', () => {
  it('rejects an oversized archive before opening it', async () => {
    const openArchive = vi.fn(() => ({ getEntries: () => [] }) as unknown as AdmZip)
    const dir = makeTempDir()
    const zipPath = join(dir, 'oversized.zip')
    writeFileSync(zipPath, Buffer.alloc(11))
    const extractor = new ZipExtractor({ maxArchiveBytes: 10 }, openArchive)

    await expect(extractor.extract(zipPath, makeTempDir())).rejects.toThrow(/archive size limit/i)
    expect(openArchive).not.toHaveBeenCalled()
  })

  it('rejects an archive with too many entries before decoding any entry', async () => {
    const firstRead = vi.fn(() => Buffer.from('{}'))
    const secondRead = vi.fn(() => Buffer.from('{}'))
    const { zipPath, openArchive } = makeStubArchive([
      { entryName: 'first.json', encrypted: false, declaredSize: 2, getData: firstRead },
      { entryName: 'second.json', encrypted: false, declaredSize: 2, getData: secondRead }
    ])
    const extractor = new ZipExtractor({ maxEntries: 1 }, openArchive)

    await expect(extractor.extract(zipPath, makeTempDir())).rejects.toThrow(/entry count limit/i)
    expect(firstRead).not.toHaveBeenCalled()
    expect(secondRead).not.toHaveBeenCalled()
  })

  it('rejects a declared entry size above the extraction limit before decoding', async () => {
    const getData = vi.fn(() => Buffer.alloc(5))
    const { zipPath, openArchive } = makeStubArchive([
      { entryName: 'large.json', encrypted: false, declaredSize: 5, getData }
    ])
    const targetDir = makeTempDir()
    const extractor = new ZipExtractor(
      { maxEntryUncompressedBytes: 4, maxTotalUncompressedBytes: 10 },
      openArchive
    )

    const result = await extractor.extract(zipPath, targetDir)

    expect(result.errors.join(' ')).toMatch(/limit/i)
    expect(result.extractedFiles).toEqual([])
    expect(getData).not.toHaveBeenCalled()
    expect(readdirSync(targetDir)).toEqual([])
  })

  it('rejects decoded entry data above the extraction limit before writing', async () => {
    const getData = vi.fn(() => Buffer.alloc(5))
    const { zipPath, openArchive } = makeStubArchive([
      { entryName: 'lying-header.json', encrypted: false, declaredSize: 1, getData }
    ])
    const targetDir = makeTempDir()
    const extractor = new ZipExtractor(
      { maxEntryUncompressedBytes: 4, maxTotalUncompressedBytes: 10 },
      openArchive
    )

    const result = await extractor.extract(zipPath, targetDir)

    expect(result.errors.join(' ')).toMatch(/limit/i)
    expect(result.extractedFiles).toEqual([])
    expect(getData).toHaveBeenCalledOnce()
    expect(readdirSync(targetDir)).toEqual([])
  })

  it('rejects a cumulative declared extraction size before decoding any entry', async () => {
    const firstRead = vi.fn(() => Buffer.alloc(4))
    const secondRead = vi.fn(() => Buffer.alloc(4))
    const { zipPath, openArchive } = makeStubArchive([
      { entryName: 'first.json', encrypted: false, declaredSize: 4, getData: firstRead },
      { entryName: 'second.json', encrypted: false, declaredSize: 4, getData: secondRead }
    ])
    const targetDir = makeTempDir()
    const extractor = new ZipExtractor(
      { maxEntryUncompressedBytes: 5, maxTotalUncompressedBytes: 6 },
      openArchive
    )

    const result = await extractor.extract(zipPath, targetDir)

    expect(result.errors.join(' ')).toMatch(/total limit/i)
    expect(result.extractedFiles).toEqual([])
    expect(firstRead).not.toHaveBeenCalled()
    expect(secondRead).not.toHaveBeenCalled()
    expect(readdirSync(targetDir)).toEqual([])
  })

  it('rejects cumulative decoded extraction data before writing the overflowing entry', async () => {
    const thirdRead = vi.fn(() => Buffer.alloc(1, 3))
    const { zipPath, openArchive } = makeStubArchive([
      {
        entryName: 'first.json',
        encrypted: false,
        declaredSize: 1,
        getData: () => Buffer.alloc(4, 1)
      },
      {
        entryName: 'second.json',
        encrypted: false,
        declaredSize: 1,
        getData: () => Buffer.alloc(4, 2)
      },
      {
        entryName: 'third.json',
        encrypted: false,
        declaredSize: 1,
        getData: thirdRead
      }
    ])
    const targetDir = makeTempDir()
    const extractor = new ZipExtractor(
      { maxEntryUncompressedBytes: 5, maxTotalUncompressedBytes: 6 },
      openArchive
    )

    const result = await extractor.extract(zipPath, targetDir)

    expect(result.errors.join(' ')).toMatch(/total limit/i)
    expect(result.extractedFiles).toHaveLength(1)
    expect(basename(result.extractedFiles[0])).toBe('first.json')
    expect(thirdRead).not.toHaveBeenCalled()
  })

  it('isolates Unicode caseless-equivalent basenames without changing their basenames', async () => {
    const dir = makeTempDir()
    const zipPath = join(dir, 'unicode-basename.zip')
    const targetDir = makeTempDir()
    const zip = new AdmZip()
    zip.addFile('case-a/FUSS.json', Buffer.from('{"case":"ascii"}'))
    zip.addFile('case-b/Fu\u00df.JSON', Buffer.from('{"case":"unicode"}'))
    zip.writeZip(zipPath)

    const result = await new ZipExtractor().extract(zipPath, targetDir)

    expect(result.errors).toEqual([])
    expect(result.extractedFiles.map((path) => basename(path))).toEqual([
      'FUSS.json',
      'Fu\u00df.JSON'
    ])
    expect(new Set(result.extractedFiles.map((path) => dirname(path))).size).toBe(2)
    expect(result.extractedFiles.map((path) => readFileSync(path, 'utf8'))).toEqual([
      '{"case":"ascii"}',
      '{"case":"unicode"}'
    ])
  })

  it('rejects case-insensitive flattened basename collisions before writing any output', async () => {
    const dir = makeTempDir()
    const zipPath = join(dir, 'duplicate-basename.zip')
    const targetDir = makeTempDir()
    const zip = new AdmZip()
    zip.addFile('case-a/sample.json', Buffer.from('{"case":"a"}'))
    zip.addFile('case-b/SAMPLE.JSON', Buffer.from('{"case":"b"}'))
    zip.writeZip(zipPath)

    const extractor = new ZipExtractor()
    const result = await extractor.extract(zipPath, targetDir)

    expect(result.extractedFiles).toEqual([])
    expect(result.errors.join(' ')).toMatch(/duplicate.*basename/i)
    expect(readdirSync(targetDir)).toEqual([])
  })

  it('redacts the supplied password from per-entry extraction errors', async () => {
    const password = 'sentinel-extraction-password'
    const getData = vi.fn(() => {
      throw new Error(`decryption failed for ${password}`)
    })
    const { zipPath, openArchive } = makeStubArchive([
      { entryName: 'secret.json', encrypted: true, declaredSize: 2, getData }
    ])
    const targetDir = makeTempDir()
    const extractor = new ZipExtractor(undefined, openArchive)

    const result = await extractor.extract(zipPath, targetDir, password)

    expect(result.errors).toHaveLength(1)
    expect(JSON.stringify(result)).not.toContain(password)
    expect(readdirSync(targetDir)).toEqual([])
  })
})
