// @vitest-environment node
/**
 * Issue #445: import batches are bounded by source bytes as well as by row
 * count. These run the real SQLite import streams over real files and count
 * how often a batch is handed to the database.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getRecordBytes } from '../../../src/main/import/bounded-batcher'
import {
  createMapperPipeline,
  streamInsertJson,
  streamInsertVcf,
  type prepareStatements
} from '../../../src/main/workers/import-pipeline'

type Statements = ReturnType<typeof prepareStatements>

/** Statement set that records the size of every batch it is asked to insert. */
function recordingStatements(): { stmts: Statements; batches: number[] } {
  const batches: number[] = []
  const stmts = {
    insertBatch: (_caseId: number, rows: unknown[]) => {
      batches.push(rows.length)
    }
  } as unknown as Statements
  return { stmts, batches }
}

const PAYLOAD_BYTES = 10_000
const ROW_LIMIT = 1_000

describe('byte-bounded import batches (SQLite worker streams)', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'varlens-batch-bytes-'))
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  function writeJson(recordCount: number): string {
    const filePath = join(tmpDir, 'oversized.json')
    writeFileSync(
      filePath,
      JSON.stringify({
        variants: Array.from({ length: recordCount }, (_, i) => ({
          chr: '1',
          pos: i + 1,
          ref: 'A',
          alt: 'T',
          annotation: 'x'.repeat(PAYLOAD_BYTES)
        }))
      })
    )
    return filePath
  }

  function writeVcf(lineCount: number): string {
    const filePath = join(tmpDir, 'oversized.vcf')
    const lines = Array.from(
      { length: lineCount },
      (_, i) => `chr1\t${i + 1}\t.\tA\tG\t99\tPASS\tNOTE=${'x'.repeat(PAYLOAD_BYTES)}\tGT\t0/1`
    )
    writeFileSync(
      filePath,
      [
        '##fileformat=VCFv4.2',
        '##INFO=<ID=NOTE,Number=1,Type=String,Description="Padding">',
        '##FORMAT=<ID=GT,Number=1,Type=String,Description="Genotype">',
        '#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tHG005',
        ...lines
      ].join('\n') + '\n'
    )
    return filePath
  }

  it('tags each mapped JSON record with the bytes the record budget counted', async () => {
    const stream = await createMapperPipeline(writeJson(3), {
      format: 'simple',
      caseKey: 'variants'
    })
    const sizes: number[] = []
    for await (const record of stream) sizes.push(getRecordBytes(record as object))

    expect(sizes).toHaveLength(3)
    for (const size of sizes) {
      // The payload plus the record's keys and short values, and nothing more.
      expect(size).toBeGreaterThanOrEqual(PAYLOAD_BYTES)
      expect(size).toBeLessThan(PAYLOAD_BYTES + 100)
    }
  })

  it('flushes oversized JSON records on the byte budget, not the row limit', async () => {
    const filePath = writeJson(10)
    const { stmts, batches } = recordingStatements()
    const progress: number[] = []

    // ~10 KB per record against a 25 KB budget: the third record of each
    // batch crosses it. The 1,000-row limit alone would give one batch of 10.
    const total = await streamInsertJson(
      filePath,
      { format: 'simple', caseKey: 'variants' },
      1,
      ROW_LIMIT,
      stmts,
      () => false,
      (count) => progress.push(count),
      { maxBatchBytes: 25_000 }
    )

    expect(total).toBe(10)
    expect(batches).toEqual([3, 3, 3, 1])
    expect(progress).toEqual([3, 6, 9, 10])
  })

  it('keeps the row limit when records are small relative to the byte budget', async () => {
    const { stmts, batches } = recordingStatements()

    await streamInsertJson(
      writeJson(10),
      { format: 'simple', caseKey: 'variants' },
      1,
      4,
      stmts,
      () => false,
      () => {},
      { maxBatchBytes: 10_000_000 }
    )

    expect(batches).toEqual([4, 4, 2])
  })

  it('uses the production 64 MiB budget by default, which ordinary records never reach', async () => {
    const { stmts, batches } = recordingStatements()

    await streamInsertJson(
      writeJson(10),
      { format: 'simple', caseKey: 'variants' },
      1,
      ROW_LIMIT,
      stmts,
      () => false,
      () => {}
    )

    expect(batches).toEqual([10])
  })

  it('flushes oversized VCF lines on the byte budget, not the row limit', async () => {
    const { stmts, batches } = recordingStatements()

    const total = await streamInsertVcf(
      writeVcf(10),
      { format: 'vcf', caseKey: '' },
      1,
      ROW_LIMIT,
      stmts,
      () => false,
      ['HG005'],
      () => {},
      undefined,
      { maxBatchBytes: 25_000 }
    )

    expect(total).toBe(10)
    expect(batches).toEqual([3, 3, 3, 1])
  })

  it('fails the VCF import when a batch insert fails, instead of skipping the line', async () => {
    const stmts = {
      insertBatch: () => {
        throw new Error('disk full')
      }
    } as unknown as Statements

    await expect(
      streamInsertVcf(
        writeVcf(3),
        { format: 'vcf', caseKey: '' },
        1,
        1,
        stmts,
        () => false,
        ['HG005'],
        () => {}
      )
    ).rejects.toThrow('disk full')
  })
})
