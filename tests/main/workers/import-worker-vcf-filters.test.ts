// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3-multiple-ciphers'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'

import { initializeSchema } from '../../../src/main/database/schema'
import { runMigrations } from '../../../src/main/database/migrations'
import { runImportSession } from '../../../src/main/workers/import-worker'
import type { FileImportRequest, WorkerMessage } from '../../../src/shared/types/import-worker'

const VCF = [
  '##fileformat=VCFv4.2',
  '##FORMAT=<ID=GT,Number=1,Type=String,Description="Genotype">',
  '##FORMAT=<ID=DP,Number=1,Type=Integer,Description="Depth">',
  '#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tS1',
  'chr1\t100\t.\tA\tT\t50\tPASS\t.\tGT:DP\t0/1:30',
  'chr1\t200\t.\tC\tG\t50\tLowQual\t.\tGT:DP\t0/1:30',
  'chr1\t300\t.\tG\tA\t5\tPASS\t.\tGT:DP\t0/1:30',
  'chr1\t400\t.\tT\tC\t50\tPASS\t.\tGT:DP\t0/1:3',
  'chr2\t100\t.\tA\tG\t50\tPASS\t.\tGT:DP\t0/1:30',
  ''
].join('\n')

/** The SQLite worker imports the first (often only) file of every VCF import (#484). */
describe('import worker applies VCF import filters', () => {
  let dir: string
  let dbPath: string
  let vcfPath: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'varlens-vcf-filters-'))
    dbPath = join(dir, 'test.db')
    vcfPath = join(dir, 'sample.vcf')
    writeFileSync(vcfPath, VCF)
    const db = new Database(dbPath)
    initializeSchema(db)
    runMigrations(db)
    db.close()
  })

  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  async function importedPositions(vcfFilters: FileImportRequest['vcfFilters']): Promise<string[]> {
    const messages: WorkerMessage[] = []
    await runImportSession(
      {
        type: 'start',
        dbPath,
        files: [
          {
            filePath: vcfPath,
            caseName: 'filtered',
            isDuplicate: false,
            duplicateStrategy: 'skip',
            vcfFilters
          }
        ],
        throttleMs: 0
      },
      { postMessage: (m) => messages.push(m) }
    )
    const complete = messages.find((m) => m.type === 'complete')
    expect(complete?.type === 'complete' && complete.results.succeeded).toBe(1)
    const db = new Database(dbPath)
    try {
      return (
        db.prepare('SELECT chr, pos FROM variants ORDER BY chr, pos').all() as Array<{
          chr: string
          pos: number
        }>
      ).map((r) => `${r.chr}:${r.pos}`)
    } finally {
      db.close()
    }
  }

  it('imports everything without filters', async () => {
    expect(await importedPositions(undefined)).toHaveLength(5)
  })

  it('drops records failing PASS-only, min QUAL and min DP', async () => {
    expect(await importedPositions({ passOnly: true, minQual: 20, minDp: 10 })).toEqual([
      'chr1:100',
      'chr2:100'
    ])
  })

  it('keeps only records inside the BED regions', async () => {
    const bedPath = join(dir, 'regions.bed')
    writeFileSync(bedPath, 'chr1\t150\t350\n')
    expect(await importedPositions({ bedFilePath: bedPath, bedPadding: 0 })).toEqual([
      'chr1:200',
      'chr1:300'
    ])
  })

  it('fails the file instead of importing unfiltered when the BED file cannot be read', async () => {
    const messages: WorkerMessage[] = []
    await runImportSession(
      {
        type: 'start',
        dbPath,
        files: [
          {
            filePath: vcfPath,
            caseName: 'filtered',
            isDuplicate: false,
            duplicateStrategy: 'skip',
            vcfFilters: { bedFilePath: join(dir, 'missing.bed') }
          }
        ],
        throttleMs: 0
      },
      { postMessage: (m) => messages.push(m) }
    )
    const complete = messages.find((m) => m.type === 'complete')
    expect(complete?.type === 'complete' && complete.results.failed).toBe(1)
    const db = new Database(dbPath)
    expect((db.prepare('SELECT COUNT(*) AS c FROM cases').get() as { c: number }).c).toBe(0)
    db.close()
  })
})
