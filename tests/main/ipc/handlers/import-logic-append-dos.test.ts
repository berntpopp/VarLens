// @vitest-environment node
/**
 * DoS-cap regression tests for the two VCF readers in
 * `import-logic-append.ts`:
 *   - `importAdditionalFileToCase` -- the main-thread multi-file append
 *     reader (2nd..Nth file of a multi-file import session).
 *   - `detectGenomeBuildFromFile` -- the genome-build preflight header
 *     reader run before each appended file is imported.
 *
 * Before this fix both built their own raw
 * `createReadStream`/`createGunzip`/`readline` pipeline with no per-line or
 * total-decompressed-byte guard. This file proves both are now routed
 * through the capped reader AND that a cap violation rejects the call
 * instead of being swallowed by the per-line `catch` in
 * `importAdditionalFileToCase` that skips unparseable rows (which would
 * silently re-hide the DoS as a "skipped line").
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { DatabaseService } from '../../../../src/main/database/DatabaseService'
import {
  importAdditionalFileToCase,
  detectGenomeBuildFromFile
} from '../../../../src/main/ipc/handlers/import-logic-append'
import {
  LineTooLongError,
  DecompressedSizeExceededError
} from '../../../../src/main/import/stream-utils'

const DECOMPRESSED_CAP_ENV_VAR = 'VARLENS_IMPORT_MAX_DECOMPRESSED_BYTES'
const LINE_CAP_ENV_VAR = 'VARLENS_TEST_IMPORT_MAX_LINE_BYTES'
const TEST_LINE_CAP = 1024

const GIANT_LINE_VCF = (giantLine: string): string =>
  [
    '##fileformat=VCFv4.2',
    '##FORMAT=<ID=GT,Number=1,Type=String,Description="Genotype">',
    '#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tHG005',
    giantLine,
    'chr1\t100\trs1\tA\tG\t99\tPASS\t.\tGT\t0/1'
  ].join('\n') + '\n'

describe('import-logic-append.ts DoS guards', () => {
  let tmpDir: string
  let svc: DatabaseService

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'varlens-import-append-dos-'))
    svc = new DatabaseService(join(tmpDir, 'varlens.db'))
    // Let DatabaseService's asynchronous startup cache cleanup release its
    // connection before the append path acquires BEGIN IMMEDIATE.
    await new Promise<void>((resolve) => setImmediate(resolve))
  })

  afterEach(() => {
    svc.close()
    rmSync(tmpDir, { recursive: true, force: true })
    delete process.env[DECOMPRESSED_CAP_ENV_VAR]
    delete process.env[LINE_CAP_ENV_VAR]
  })

  describe('importAdditionalFileToCase', () => {
    it('rejects a giant line with LineTooLongError -- not a silent per-line skip', async () => {
      process.env[LINE_CAP_ENV_VAR] = String(TEST_LINE_CAP)
      const filePath = join(tmpDir, 'giant-line.vcf')
      writeFileSync(filePath, GIANT_LINE_VCF('A'.repeat(TEST_LINE_CAP + 1)))

      const caseId = svc.cases.createCase('test-append-giant-line', filePath, 1000)
      svc.variants.beginBulkInsert()

      await expect(
        importAdditionalFileToCase(caseId, filePath, { selectedSample: 'HG005' }, () => svc, {})
      ).rejects.toThrow(LineTooLongError)
    })

    it('rolls back earlier batches when a late line exceeds the cap', async () => {
      process.env[LINE_CAP_ENV_VAR] = String(TEST_LINE_CAP)
      const filePath = join(tmpDir, 'late-giant-line.vcf')
      const validRows = Array.from(
        { length: 10_000 },
        (_, index) => `chr1\t${index + 1}\t.\tA\tG\t99\tPASS\t.\tGT\t0/1`
      )
      writeFileSync(
        filePath,
        GIANT_LINE_VCF(validRows.concat('A'.repeat(TEST_LINE_CAP + 1)).join('\n'))
      )

      const caseId = svc.cases.createCase('test-append-late-giant-line', filePath, 1000)
      svc.variants.beginBulkInsert()

      await expect(
        importAdditionalFileToCase(caseId, filePath, { selectedSample: 'HG005' }, () => svc, {})
      ).rejects.toThrow(LineTooLongError)

      svc.variants.recalculateCaseVariantCount(caseId)
      expect(svc.cases.getCase(caseId)?.variant_count).toBe(0)
    })

    it('rejects a decompression bomb once decompressed bytes exceed the configured cap', async () => {
      process.env[DECOMPRESSED_CAP_ENV_VAR] = '1000'
      const filePath = join(tmpDir, 'bomb.vcf.gz')
      const inflated =
        [
          '##fileformat=VCFv4.2',
          '##FORMAT=<ID=GT,Number=1,Type=String,Description="Genotype">',
          '#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tHG005'
        ].join('\n') +
        '\n' +
        'A'.repeat(1_000_000) +
        '\n'
      writeFileSync(filePath, gzipSync(Buffer.from(inflated)))

      const caseId = svc.cases.createCase('test-append-bomb', filePath, 1000)
      svc.variants.beginBulkInsert()

      await expect(
        importAdditionalFileToCase(caseId, filePath, { selectedSample: 'HG005' }, () => svc, {})
      ).rejects.toThrow(DecompressedSizeExceededError)
    })

    it('still appends a legitimate small VCF without false rejection (sanity check)', async () => {
      const filePath = join(tmpDir, 'legit.vcf')
      writeFileSync(
        filePath,
        [
          '##fileformat=VCFv4.2',
          '##FORMAT=<ID=GT,Number=1,Type=String,Description="Genotype">',
          '#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tHG005',
          'chr1\t100\trs1\tA\tG\t99\tPASS\t.\tGT\t0/1'
        ].join('\n') + '\n'
      )

      const caseId = svc.cases.createCase('test-append-legit', filePath, 1000)
      svc.variants.beginBulkInsert()

      const result = await importAdditionalFileToCase(
        caseId,
        filePath,
        { selectedSample: 'HG005' },
        () => svc,
        {}
      )

      expect(result.variantCount).toBe(1)
      expect(result.errors).toEqual([])
    })

    it('uses an isolated connection and rolls back promptly when cancelled', async () => {
      const filePath = join(tmpDir, 'cancel.vcf')
      const rows = Array.from(
        { length: 5_001 },
        (_, index) => `chr1\t${index + 1}\t.\tA\tG\t99\tPASS\t.\tGT\t0/1`
      )
      writeFileSync(
        filePath,
        [
          '##fileformat=VCFv4.2',
          '##FORMAT=<ID=GT,Number=1,Type=String,Description="Genotype">',
          '#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tHG005',
          ...rows
        ].join('\n') + '\n'
      )
      const caseId = svc.cases.createCase('test-append-cancel', filePath, 1000)
      svc.variants.beginBulkInsert()
      const controller = new AbortController()
      let mainConnectionWasInTransaction = true

      await expect(
        importAdditionalFileToCase(
          caseId,
          filePath,
          { selectedSample: 'HG005' },
          () => svc,
          {
            onProgress: () => {
              mainConnectionWasInTransaction = svc.database.inTransaction
              controller.abort()
            }
          },
          undefined,
          controller.signal
        )
      ).rejects.toThrow(/cancelled/i)

      expect(mainConnectionWasInTransaction).toBe(false)
      svc.variants.recalculateCaseVariantCount(caseId)
      expect(svc.cases.getCase(caseId)?.variant_count).toBe(0)
    })
  })

  describe('detectGenomeBuildFromFile', () => {
    it('rejects a giant header-adjacent line with LineTooLongError', async () => {
      process.env[LINE_CAP_ENV_VAR] = String(TEST_LINE_CAP)
      const filePath = join(tmpDir, 'giant-header.vcf')
      // The oversized line sits among header lines (before #CHROM), so the
      // preflight header reader -- which only reads up to the first data
      // line -- still encounters it.
      const giantHeaderLine = '##' + 'A'.repeat(TEST_LINE_CAP + 1)
      writeFileSync(
        filePath,
        [
          '##fileformat=VCFv4.2',
          giantHeaderLine,
          '#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tHG005',
          'chr1\t100\trs1\tA\tG\t99\tPASS\t.\tGT\t0/1'
        ].join('\n') + '\n'
      )

      await expect(detectGenomeBuildFromFile(filePath)).rejects.toThrow(LineTooLongError)
    })

    it('rejects a decompression bomb in the header preflight reader', async () => {
      process.env[DECOMPRESSED_CAP_ENV_VAR] = '1000'
      const filePath = join(tmpDir, 'bomb-header.vcf.gz')
      const inflated = '##' + 'A'.repeat(1_000_000) + '\n#CHROM\tPOS\n'
      writeFileSync(filePath, gzipSync(Buffer.from(inflated)))

      await expect(detectGenomeBuildFromFile(filePath)).rejects.toThrow(
        DecompressedSizeExceededError
      )
    })

    it('returns the declared genome build for a legitimate header (sanity check)', async () => {
      const filePath = join(tmpDir, 'legit-header.vcf')
      writeFileSync(
        filePath,
        [
          '##fileformat=VCFv4.2',
          '##reference=GRCh38',
          '#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tHG005',
          'chr1\t100\trs1\tA\tG\t99\tPASS\t.\tGT\t0/1'
        ].join('\n') + '\n'
      )

      const build = await detectGenomeBuildFromFile(filePath)
      expect(build).toBe('GRCh38')
    })
  })
})
