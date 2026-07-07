// @vitest-environment node
/**
 * DoS-cap regression tests for `streamMappedVcfRows` in
 * `postgres-import-worker.ts` -- the live PostgreSQL VCF import path.
 *
 * `streamMappedVcfRows` is a pure async generator over a file (no DB
 * connection needed to exercise the parsing/streaming layer), so it is
 * unit-testable directly without a running Postgres container. Before this
 * fix it built its own raw `createReadStream`/`createGunzip`/`readline`
 * pipeline with no per-line or total-decompressed-byte guard. This file
 * proves the shared capped reader (`createCappedLineStream`) is now wired
 * in AND that a cap violation propagates as a thrown/rejected error from
 * the generator instead of being swallowed by the per-line `catch` that
 * skips unparseable lines (which would silently re-hide the DoS as a
 * "skipped line" and keep yielding rows).
 */
import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { streamMappedVcfRows } from '../../../src/main/workers/postgres-import-worker'
import {
  MAX_LINE_BYTES,
  LineTooLongError,
  DecompressedSizeExceededError
} from '../../../src/main/import/stream-utils'
import type { VcfMappedVariant } from '../../../src/main/import/vcf/types'

const DECOMPRESSED_CAP_ENV_VAR = 'VARLENS_IMPORT_MAX_DECOMPRESSED_BYTES'

/** Drain an async generator into an array, surfacing any thrown error. */
async function drain(
  gen: AsyncGenerator<VcfMappedVariant, void, void>
): Promise<VcfMappedVariant[]> {
  const rows: VcfMappedVariant[] = []
  for await (const row of gen) {
    rows.push(row)
  }
  return rows
}

describe('streamMappedVcfRows DoS guards (postgres-import-worker.ts, live PG worker path)', () => {
  let tmpDir: string

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
    delete process.env[DECOMPRESSED_CAP_ENV_VAR]
  })

  it('rejects a VCF containing a line over MAX_LINE_BYTES with LineTooLongError -- not a silent skip', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'varlens-pg-worker-dos-'))
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

    await expect(drain(streamMappedVcfRows(filePath, 'HG005'))).rejects.toThrow(LineTooLongError)
  })

  it('rejects a decompression bomb once decompressed bytes exceed the configured cap', async () => {
    process.env[DECOMPRESSED_CAP_ENV_VAR] = '1000'
    tmpDir = mkdtempSync(join(tmpdir(), 'varlens-pg-worker-bomb-'))
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

    await expect(drain(streamMappedVcfRows(filePath, 'HG005'))).rejects.toThrow(
      DecompressedSizeExceededError
    )
  })

  it('still yields rows for a legitimate small VCF without false rejection (sanity check)', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'varlens-pg-worker-legit-'))
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

    const rows = await drain(streamMappedVcfRows(filePath, 'HG005'))
    expect(rows.length).toBe(1)
  })

  it('reports malformed POS lines through the skip callback while yielding valid rows', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'varlens-pg-worker-invalid-pos-'))
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
    const skips: string[] = []

    const rows = await drain(
      streamMappedVcfRows(filePath, 'HG005', undefined, (reason) => skips.push(reason))
    )

    expect(rows.length).toBe(1)
    expect(skips).toHaveLength(1)
    expect(skips[0]).toMatch(/invalid POS/i)
  })
})
