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
import {
  prepareStatements,
  streamInsertJson,
  streamInsertVcf
} from '../../../src/main/workers/import-pipeline'
import {
  LineTooLongError,
  DecompressedSizeExceededError
} from '../../../src/main/import/stream-utils'
import type { FormatInfo } from '../../../src/main/import/strategies/ImportStrategy'
import { VcfHeaderLimitExceededError } from '../../../src/main/import/vcf/vcf-header-limits'
import {
  JsonRecordLimitError,
  MAX_JSON_RECORD_BYTES,
  MAX_JSON_RECORD_CONTAINER_ENTRIES,
  MAX_JSON_RECORD_DEPTH
} from '../../../src/main/import/json-resource-budget'

const DECOMPRESSED_CAP_ENV_VAR = 'VARLENS_IMPORT_MAX_DECOMPRESSED_BYTES'
const LINE_CAP_ENV_VAR = 'VARLENS_TEST_IMPORT_MAX_LINE_BYTES'
const TEST_LINE_CAP = 1024
const HEADER_LINES_CAP_ENV_VAR = 'VARLENS_VCF_MAX_HEADER_LINES'
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
    delete process.env[LINE_CAP_ENV_VAR]
    delete process.env[HEADER_LINES_CAP_ENV_VAR]
  })

  it('rejects a VCF line over the production call-path cap -- not a silent skip', async () => {
    process.env[LINE_CAP_ENV_VAR] = String(TEST_LINE_CAP)
    const filePath = join(tmpDir, 'giant-line.vcf')
    const giantLine = 'A'.repeat(TEST_LINE_CAP + 1)
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
        'chr1\t99\trs-bad-qual\tA\tG\tBADQUAL\tPASS\t.\tGT\t0/1',
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
    expect(skips).toHaveLength(2)
    expect(skips.some((reason) => /invalid POS/i.test(reason))).toBe(true)
    expect(skips.some((reason) => /invalid QUAL/i.test(reason))).toBe(true)
  })

  it('rejects a VCF header exceeding the independent header-line budget', async () => {
    process.env[HEADER_LINES_CAP_ENV_VAR] = '3'
    const filePath = join(tmpDir, 'many-header-lines.vcf')
    writeFileSync(
      filePath,
      [
        '##fileformat=VCFv4.2',
        '##source=a',
        '##source=b',
        '#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tHG005',
        'chr1\t100\trs1\tA\tG\t99\tPASS\t.\tGT\t0/1'
      ].join('\n') + '\n'
    )

    const caseId = svc.cases.createCase('test-header-lines', filePath, 1000)
    const stmts = prepareStatements(svc.database)

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
    ).rejects.toThrow(VcfHeaderLimitExceededError)
  })

  it.each<{
    name: string
    formatInfo: FormatInfo
    json: string
  }>([
    {
      name: 'simple',
      formatInfo: { format: 'simple', caseKey: 'variants' },
      json: `{"variants":[${' '.repeat(10_000)}]}`
    },
    {
      name: 'object',
      formatInfo: { format: 'object', caseKey: 'sample-1' },
      json: `{"metadata":{},"samples":{"sample-1":{"variants":[${' '.repeat(10_000)}]}}}`
    },
    {
      name: 'columnar',
      formatInfo: { format: 'columnar', caseKey: '', wrapped: false },
      json: `{"header":[],"data":[${' '.repeat(10_000)}]}`
    }
  ])(
    'rejects a $name JSON gzip bomb through the live mapper path',
    async ({ formatInfo, json }) => {
      process.env[DECOMPRESSED_CAP_ENV_VAR] = '512'
      const filePath = join(tmpDir, `${formatInfo.format}-bomb.json.gz`)
      writeFileSync(filePath, gzipSync(Buffer.from(json)))

      const caseId = svc.cases.createCase(`test-${formatInfo.format}-bomb`, filePath, 1000)
      const stmts = prepareStatements(svc.database)

      await expect(
        streamInsertJson(
          filePath,
          formatInfo,
          caseId,
          5000,
          stmts,
          () => false,
          () => {}
        )
      ).rejects.toThrow(DecompressedSizeExceededError)
    }
  )

  it.each([
    { name: 'plain', gzip: false },
    { name: 'gzip', gzip: true }
  ])('rejects one oversized JSON record before materialization ($name)', async ({ name, gzip }) => {
    const filePath = join(tmpDir, `oversized-record-${name}.json${gzip ? '.gz' : ''}`)
    const json = JSON.stringify({
      variants: [
        {
          chr: '1',
          pos: 1,
          ref: 'A',
          alt: 'T',
          payload: 'x'.repeat(MAX_JSON_RECORD_BYTES + 1)
        }
      ]
    })
    writeFileSync(filePath, gzip ? gzipSync(Buffer.from(json)) : json)

    const caseId = svc.cases.createCase(`test-oversized-${name}`, filePath, json.length)
    const stmts = prepareStatements(svc.database)

    await expect(
      streamInsertJson(
        filePath,
        { format: 'simple', caseKey: 'variants' },
        caseId,
        5000,
        stmts,
        () => false,
        () => {}
      )
    ).rejects.toThrow(JsonRecordLimitError)
  })

  it.each([
    {
      name: 'container entries',
      makePayload: () => Array.from({ length: MAX_JSON_RECORD_CONTAINER_ENTRIES + 1 }, () => null)
    },
    {
      name: 'nesting depth',
      makePayload: () => {
        const root: Record<string, unknown> = {}
        let cursor = root
        for (let index = 0; index < MAX_JSON_RECORD_DEPTH; index += 1) {
          const child: Record<string, unknown> = {}
          cursor.child = child
          cursor = child
        }
        return root
      }
    }
  ])('rejects a JSON record exceeding its $name budget', async ({ name, makePayload }) => {
    const filePath = join(tmpDir, `oversized-${name.replace(' ', '-')}.json`)
    const json = JSON.stringify({
      variants: [{ chr: '1', pos: 1, ref: 'A', alt: 'T', payload: makePayload() }]
    })
    writeFileSync(filePath, json)
    const caseId = svc.cases.createCase(`test-${name}`, filePath, json.length)

    await expect(
      streamInsertJson(
        filePath,
        { format: 'simple', caseKey: 'variants' },
        caseId,
        5000,
        prepareStatements(svc.database),
        () => false,
        () => {}
      )
    ).rejects.toThrow(JsonRecordLimitError)
  })
})
