// @vitest-environment node
/**
 * DoS-cap regression tests for `streamInsertVcf` in `import-pipeline.ts` --
 * the live SQLite single-file VCF import path (the default worker import
 * route, used by `import-worker.ts`).
 *
 * Before this fix, `streamInsertVcf` built its own raw
 * `createReadStream`/`createGunzip`/`readline` pipeline with no per-line or
 * total-decompressed-byte guard, so a pathological giant line or a
 * decompression bomb would buffer unboundedly in the worker thread. This
 * file proves the shared capped reader (`createCappedLineStream`) is now
 * wired in AND that a cap violation rejects the whole import instead of
 * being swallowed by the per-line `catch` that skips unparseable rows
 * (which would silently re-hide the DoS as a "skipped line").
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { DatabaseService } from '../../../src/main/database/DatabaseService'
import { prepareStatements, streamInsertVcf } from '../../../src/main/workers/import-pipeline'
import {
  MAX_LINE_BYTES,
  LineTooLongError,
  DecompressedSizeExceededError
} from '../../../src/main/import/stream-utils'
import type { FormatInfo } from '../../../src/main/import/strategies/ImportStrategy'

const DECOMPRESSED_CAP_ENV_VAR = 'VARLENS_IMPORT_MAX_DECOMPRESSED_BYTES'
const VCF_FORMAT: FormatInfo = { format: 'vcf', caseKey: '' }

describe('streamInsertVcf DoS guards (import-pipeline.ts, live SQLite worker path)', () => {
  let tmpDir: string
  let svc: DatabaseService

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'varlens-import-pipeline-dos-'))
    svc = new DatabaseService(':memory:')
  })

  afterEach(() => {
    svc.close()
    rmSync(tmpDir, { recursive: true, force: true })
    delete process.env[DECOMPRESSED_CAP_ENV_VAR]
  })

  it('rejects a VCF containing a line over MAX_LINE_BYTES with LineTooLongError -- not a silent skip', async () => {
    const filePath = join(tmpDir, 'giant-line.vcf')
    const giantLine = 'A'.repeat(MAX_LINE_BYTES + 1)
    writeFileSync(
      filePath,
      [
        '##fileformat=VCFv4.2',
        '##FORMAT=<ID=GT,Number=1,Type=String,Description="Genotype">',
        '#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tHG005',
        giantLine,
        'chr1\t100\trs1\tA\tG\t99\tPASS\t.\tGT\t0/1'
      ].join('\n') + '\n'
    )

    const caseId = svc.cases.createCase('test-giant-line', filePath, 1000)
    const stmts = prepareStatements(svc.database)
    stmts.beginBulkInsert()

    await expect(
      streamInsertVcf(
        filePath,
        VCF_FORMAT,
        caseId,
        5000,
        stmts,
        () => false,
        ['HG005'],
        () => {}
      )
    ).rejects.toThrow(LineTooLongError)

    // The valid line preceding the giant line must NOT have been silently
    // counted as a "successful partial import" that hides the failure --
    // the promise itself rejects, which is what the worker's per-file
    // try/catch treats as a hard file failure (see import-worker.ts).
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

    const caseId = svc.cases.createCase('test-bomb', filePath, 1000)
    const stmts = prepareStatements(svc.database)
    stmts.beginBulkInsert()

    await expect(
      streamInsertVcf(
        filePath,
        VCF_FORMAT,
        caseId,
        5000,
        stmts,
        () => false,
        ['HG005'],
        () => {}
      )
    ).rejects.toThrow(DecompressedSizeExceededError)
  })

  it('still imports a legitimate small VCF without false rejection (sanity check)', async () => {
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

    const caseId = svc.cases.createCase('test-legit', filePath, 1000)
    const stmts = prepareStatements(svc.database)
    stmts.beginBulkInsert()

    const count = await streamInsertVcf(
      filePath,
      VCF_FORMAT,
      caseId,
      5000,
      stmts,
      () => false,
      ['HG005'],
      () => {}
    )

    expect(count).toBe(1)
  })

  it('reports malformed POS lines through the skip callback while importing valid rows', async () => {
    const filePath = join(tmpDir, 'invalid-pos.vcf')
    writeFileSync(
      filePath,
      [
        '##fileformat=VCFv4.2',
        '##FORMAT=<ID=GT,Number=1,Type=String,Description="Genotype">',
        '#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tHG005',
        'chr1\tNOTNUM\trs-bad\tA\tG\t99\tPASS\t.\tGT\t0/1',
        'chr1\t100\trs-good\tA\tG\t99\tPASS\t.\tGT\t0/1'
      ].join('\n') + '\n'
    )

    const caseId = svc.cases.createCase('test-invalid-pos', filePath, 1000)
    const stmts = prepareStatements(svc.database)
    stmts.beginBulkInsert()
    const skips: string[] = []

    const count = await streamInsertVcf(
      filePath,
      VCF_FORMAT,
      caseId,
      5000,
      stmts,
      () => false,
      ['HG005'],
      () => {},
      (reason) => skips.push(reason)
    )

    expect(count).toBe(1)
    expect(skips).toHaveLength(1)
    expect(skips[0]).toMatch(/invalid POS/i)
  })
})
