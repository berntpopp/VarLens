// @vitest-environment node
/**
 * DoS-cap regression tests for `detectGenomeBuildFromFile` in
 * `import-logic-append.ts`, the genome-build preflight header reader run
 * before each appended file is imported: it is routed through the capped
 * reader. The appended rows themselves are read by the import worker
 * (import-pipeline-dos.test.ts).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { detectGenomeBuildFromFile } from '../../../../src/main/ipc/handlers/import-logic-append'
import {
  LineTooLongError,
  DecompressedSizeExceededError
} from '../../../../src/main/import/stream-utils'

const DECOMPRESSED_CAP_ENV_VAR = 'VARLENS_IMPORT_MAX_DECOMPRESSED_BYTES'
const LINE_CAP_ENV_VAR = 'VARLENS_TEST_IMPORT_MAX_LINE_BYTES'
const TEST_LINE_CAP = 1024

describe('import-logic-append.ts DoS guards', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'varlens-import-append-dos-'))
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
    delete process.env[DECOMPRESSED_CAP_ENV_VAR]
    delete process.env[LINE_CAP_ENV_VAR]
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
