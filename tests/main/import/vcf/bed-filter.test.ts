import { describe, it, expect, afterEach, beforeAll } from 'vitest'
import { mkdtempSync, rmSync, truncateSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { gzipSync } from 'node:zlib'
import {
  BedFilter,
  MAX_BED_FILTER_DECOMPRESSED_BYTES
} from '../../../../src/main/import/vcf/bed-filter'
import {
  BedEntryLimitExceededError,
  InvalidBedRowError,
  parseBedEntry,
  readBedEntries
} from '../../../../src/main/import/vcf/bed-reader'
import { DecompressedSizeExceededError } from '../../../../src/main/import/stream-utils'
import path from 'path'
import { performance } from 'node:perf_hooks'

const BED_PATH = path.join(__dirname, '../../../test-data/vcf/test-regions.bed')
const DECOMPRESSED_CAP_ENV_VAR = 'VARLENS_IMPORT_MAX_DECOMPRESSED_BYTES'

describe('BedFilter', () => {
  describe('fromFile worker-safe defensive check', () => {
    it('rejects relative paths', async () => {
      await expect(BedFilter.fromFile('relative/foo.bed', 0)).rejects.toThrow(
        /must be an absolute path/i
      )
    })

    it('rejects paths containing .. after resolve', async () => {
      await expect(BedFilter.fromFile('/tmp/../etc/shadow', 0)).rejects.toThrow(
        /must not contain '\.\.'/i
      )
    })

    it('passes the defensive check for an absolute path that does not exist (fails on read, not on guard)', async () => {
      await expect(BedFilter.fromFile('/tmp/does-not-exist.bed', 0)).rejects.toThrow(
        /ENOENT|no such file/i
      )
    })
  })

  describe('loadFromFile', () => {
    it('loads intervals from a BED file', async () => {
      const filter = await BedFilter.fromFile(BED_PATH, 0)
      expect(filter.intervalCount()).toBe(4)
    })

    it('applies padding to intervals', async () => {
      const filter = await BedFilter.fromFile(BED_PATH, 100)
      // chr1:999000-1010000 with +/-100 -> chr1:998901-1010100 (1-based inclusive)
      expect(filter.contains('chr1', 998950)).toBe(true)
      expect(filter.contains('chr1', 998850)).toBe(false)
    })

    it('rejects more valid BED rows than the configured entry cap', async () => {
      const tmpDir = mkdtempSync(path.join(tmpdir(), 'varlens-bed-entries-'))
      const filePath = path.join(tmpDir, 'too-many.bed')
      writeFileSync(filePath, 'chr1\t0\t1\nchr1\t2\t3\nchr1\t4\t5\n')

      try {
        const collect = async (): Promise<void> => {
          for await (const entry of readBedEntries(filePath, 10_000, { maxEntries: 2 })) {
            void entry
          }
        }
        await expect(collect()).rejects.toThrow(BedEntryLimitExceededError)
      } finally {
        rmSync(tmpDir, { recursive: true, force: true })
      }
    })

    it('rejects BED coordinates outside JavaScript safe-integer range', () => {
      expect(
        parseBedEntry(`chr1\t${Number.MAX_SAFE_INTEGER + 1}\t${Number.MAX_SAFE_INTEGER + 2}`)
      ).toBeNull()
    })

    it('parses only the first four fields of a token-dense BED line', () => {
      const denseRemainder = ' ignored'.repeat(1_000_000)
      const startedAt = performance.now()

      expect(parseBedEntry(`chr1 0 10 label${denseRemainder}`)).toEqual({
        chr: 'chr1',
        start: 0,
        end: 10,
        label: 'label'
      })
      expect(performance.now() - startedAt).toBeLessThan(20)
    })

    it('bounds strict malformed-row diagnostics independently of the line cap', async () => {
      const tmpDir = mkdtempSync(path.join(tmpdir(), 'varlens-bed-error-'))
      const filePath = path.join(tmpDir, 'malformed.bed')
      writeFileSync(filePath, `not-a-bed-row-${'x'.repeat(1024 * 1024)}\n`)

      try {
        const consume = async (): Promise<void> => {
          for await (const entry of readBedEntries(filePath, 2 * 1024 * 1024, {
            rejectMalformedRows: true
          })) {
            void entry
          }
        }
        const error = await consume().catch((caught: unknown) => caught)

        expect(error).toBeInstanceOf(InvalidBedRowError)
        expect((error as Error).message.length).toBeLessThan(512)
      } finally {
        rmSync(tmpDir, { recursive: true, force: true })
      }
    })
  })

  describe('contains (point query)', () => {
    let filter: BedFilter
    beforeAll(async () => {
      filter = await BedFilter.fromFile(BED_PATH, 0)
    })

    it('returns true for position inside interval', () => {
      expect(filter.contains('chr1', 1000000)).toBe(true)
    })

    it('returns false for position outside all intervals', () => {
      expect(filter.contains('chr1', 2000000)).toBe(false)
    })

    it('returns true at interval start (1-based inclusive)', () => {
      // BED is 0-based half-open [999000, 1010000)
      // 1-based inclusive: [999001, 1010000]
      expect(filter.contains('chr1', 999001)).toBe(true)
    })

    it('returns true at interval end (1-based inclusive)', () => {
      expect(filter.contains('chr1', 1010000)).toBe(true)
    })

    it('returns false for unknown chromosome', () => {
      expect(filter.contains('chr99', 1000000)).toBe(false)
    })
  })

  describe('containsRange (interval overlap query for SV/CNV)', () => {
    let filter: BedFilter
    beforeAll(async () => {
      filter = await BedFilter.fromFile(BED_PATH, 0)
    })

    it('returns true when range overlaps a BED region', () => {
      // Range chr1:990000-1005000 overlaps BED chr1:999001-1010000
      expect(filter.containsRange('chr1', 990000, 1005000)).toBe(true)
    })

    it('returns false when range is entirely outside', () => {
      expect(filter.containsRange('chr1', 2000000, 2100000)).toBe(false)
    })

    it('returns true when range fully contains a BED region', () => {
      expect(filter.containsRange('chr1', 900000, 1100000)).toBe(true)
    })
  })

  describe('empty filter', () => {
    it('contains() always returns true when no BED loaded', () => {
      const filter = BedFilter.empty()
      expect(filter.contains('chr1', 12345)).toBe(true)
      expect(filter.containsRange('chr1', 100, 200)).toBe(true)
    })
  })

  describe('fromFile DoS guards (replaces unbounded gunzipSync(readFileSync()) full-slurp)', () => {
    let tmpDir: string

    afterEach(() => {
      delete process.env[DECOMPRESSED_CAP_ENV_VAR]
      if (tmpDir) rmSync(tmpDir, { recursive: true, force: true })
    })

    it('rejects a plain BED file whose size exceeds the configured total-byte cap', async () => {
      process.env[DECOMPRESSED_CAP_ENV_VAR] = '1000'
      tmpDir = mkdtempSync(path.join(tmpdir(), 'varlens-bed-dos-'))
      const filePath = path.join(tmpDir, 'giant.bed')
      writeFileSync(filePath, 'chr1\t1\t2\n'.repeat(1000)) // ~9000 bytes > 1000-byte cap

      await expect(BedFilter.fromFile(filePath, 0)).rejects.toThrow(DecompressedSizeExceededError)
    })

    it('uses a BED-specific cap instead of the import-wide 256 GiB default', async () => {
      tmpDir = mkdtempSync(path.join(tmpdir(), 'varlens-bed-specific-cap-'))
      const filePath = path.join(tmpDir, 'oversized.bed')
      writeFileSync(filePath, '')
      truncateSync(filePath, MAX_BED_FILTER_DECOMPRESSED_BYTES + 1)

      await expect(BedFilter.fromFile(filePath, 0)).rejects.toThrow(DecompressedSizeExceededError)
    })

    it('rejects a gzip decompression bomb once decompressed bytes exceed the configured cap', async () => {
      process.env[DECOMPRESSED_CAP_ENV_VAR] = '1000'
      tmpDir = mkdtempSync(path.join(tmpdir(), 'varlens-bed-bomb-'))
      const filePath = path.join(tmpDir, 'bomb.bed.gz')
      // Highly compressible content: a tiny gzip payload that inflates far
      // past the small test cap -- stands in for a real decompression bomb.
      const inflated = 'chr1\t1\t2\n'.repeat(200_000)
      writeFileSync(filePath, gzipSync(Buffer.from(inflated)))

      await expect(BedFilter.fromFile(filePath, 0)).rejects.toThrow(DecompressedSizeExceededError)
    })

    it('still loads a legitimate BED file under the default cap', async () => {
      // No env override -- exercises the real default (256 GiB) cap, proving
      // no false rejection of a normal-sized file.
      const filter = await BedFilter.fromFile(BED_PATH, 0)
      expect(filter.intervalCount()).toBe(4)
    })
  })
})
