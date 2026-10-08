// @vitest-environment node
/**
 * The import filters of one multi-file VCF import (SNV + SV + CNV + STR into
 * one case) keep the same records on SQLite and on PostgreSQL, whichever file
 * comes first. Every expectation is written out per filter and per variant
 * type, so a filter that would wipe out a whole callset fails here.
 *
 * SQLite runs always: the worker imports file 1, the append path files 2..N,
 * as `startMultiFileImportSqlite` does. PostgreSQL runs the real import worker
 * against a real instance and is gated by VARLENS_RUN_POSTGRES_E2E=1 (needs a
 * reachable VARLENS_PG_URL).
 */
import { randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import Database from 'better-sqlite3-multiple-ciphers'
import { Client, Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { DatabaseService } from '../../../src/main/database/DatabaseService'
import { detectFormat } from '../../../src/main/import/format-detection'
import { loadImportFilters } from '../../../src/main/import/vcf/import-filters'
import { importAdditionalFileToCase } from '../../../src/main/ipc/handlers/import-logic-append'
import { POSTGRES_MIGRATIONS } from '../../../src/main/storage/postgres/migrations/definitions'
import { PostgresMigrationRunner } from '../../../src/main/storage/postgres/migrations/PostgresMigrationRunner'
import { createMapperPipeline } from '../../../src/main/workers/import-pipeline'
import { runImportSession } from '../../../src/main/workers/import-worker'
import { runImport, streamMappedVcfRows } from '../../../src/main/workers/postgres-import-worker'
import type { FileImportRequest, WorkerMessage } from '../../../src/shared/types/import-worker'
import type { PostgresImportWorkerOutboundMessage } from '../../../src/shared/types/postgres-import-worker'

const RUN_PG = process.env.VARLENS_RUN_POSTGRES_E2E === '1'
const PG_URL =
  process.env.VARLENS_PG_URL ??
  'postgres://varlens:varlens_dev_password@127.0.0.1:55432/varlens_dev'

const VCF_DIR = resolve(__dirname, '../../test-data/vcf')
const SAMPLE = 'SAMPLE1'

// POS doubles as the row's label: what each row is there to prove.
const SNV_VCF = [
  '##fileformat=VCFv4.2',
  '##FORMAT=<ID=GT,Number=1,Type=String,Description="Genotype">',
  '##FORMAT=<ID=GQ,Number=1,Type=Integer,Description="Genotype quality">',
  '##FORMAT=<ID=DP,Number=1,Type=Integer,Description="Depth">',
  `#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\t${SAMPLE}`,
  'chr1\t100\t.\tA\tT\t50\tPASS\t.\tGT:GQ:DP\t0/1:40:30', // passes every filter
  'chr1\t200\t.\tC\tG\t50\tLowQual\t.\tGT:GQ:DP\t0/1:40:30', // fails PASS-only
  'chr1\t300\t.\tG\tA\t5\tPASS\t.\tGT:GQ:DP\t0/1:40:30', // fails min QUAL
  'chr1\t400\t.\tT\tC\t50\tPASS\t.\tGT:GQ:DP\t0/1:40:3', // fails min DP
  'chr1\t500\t.\tA\tG\t50\tPASS\t.\tGT:GQ:DP\t0/1:5:30', // fails min GQ
  'chr1\t600\t.\tC\tT\t.\t.\t.\tGT:GQ:DP\t0/1:.:.', // nothing to judge: always kept
  'chr3\t100\t.\tA\tG\t50\tPASS\t.\tGT:GQ:DP\t0/0:40:30', // hom-ref: never a variant
  // The three unreadable rows; each must be counted as skipped on every path.
  'chr1\t700\t.\tA', // truncated
  'chr1\t800\t.\tA\tT\t50\tPASS\t.', // no FORMAT and sample column
  'chr1\t900\t.\tA\tT\t50\tPASS\t.\tGT:GQ:DP\t0/2:40:30', // GT names an allele the row lacks
  ''
].join('\n')

// 0-based half-open. The chr22 and chr21 regions hit their record only through
// its POS..END interval, not through POS.
const BED = [
  'chr1\t0\t250',
  'chr1\t999000\t1010000',
  'chr1\t5000000\t5600000',
  'chr22\t29010000\t29010100',
  'chr21\t43776460\t43776470',
  ''
].join('\n')

const SNV = ['chr1:100', 'chr1:200', 'chr1:300', 'chr1:400', 'chr1:500', 'chr1:600']
// Sniffles2: QUAL, FILTER and FORMAT/GQ set (GQ 40, 50, 20, 5, 30), no FORMAT/DP.
const SV = ['chr1:1000000', 'chr1:2000000', 'chr22:29000000', 'chr2:5000000', 'chr1:9000000']
// Spectre: QUAL '.', all PASS, FORMAT/GQ 30, 25, 40, no FORMAT/DP.
const CNV = ['chr1:5000000', 'chr1:10000000', 'chr22:29500000']
// Straglr-style: QUAL '.', no GQ, no DP; chr14 is two alleles, chr1 is LowDepth.
const STR = ['chr14:92071010', 'chr14:92071010', 'chr21:43776444', 'chr1:149390803']

const without = (rows: string[], ...dropped: string[]): string[] =>
  rows.filter((row) => !dropped.includes(row))

interface FilterCase {
  name: string
  filters: NonNullable<FileImportRequest['vcfFilters']> | undefined
  bed?: true
  expected: string[]
  /** Unreadable rows counted; 3 unless a filter drops a row before its genotype is read. */
  skipped?: number
}

const CASES: FilterCase[] = [
  { name: 'no filters', filters: undefined, expected: [...SNV, ...SV, ...CNV, ...STR] },
  {
    name: 'PASS only',
    filters: { passOnly: true },
    expected: [
      ...without(SNV, 'chr1:200'),
      ...without(SV, 'chr2:5000000'),
      ...CNV,
      ...without(STR, 'chr1:149390803')
    ]
  },
  {
    // QUAL '.' is not a failing score: the CNV and STR callsets survive.
    name: 'min QUAL 20',
    filters: { minQual: 20 },
    expected: [...without(SNV, 'chr1:300'), ...without(SV, 'chr2:5000000'), ...CNV, ...STR]
  },
  {
    // Records that carry FORMAT/GQ are judged by it, whatever their type;
    // records without it (STR) are kept.
    name: 'min GQ 35',
    filters: { minGq: 35 },
    expected: [
      ...without(SNV, 'chr1:500'),
      'chr1:1000000',
      'chr1:2000000',
      'chr22:29500000',
      ...STR
    ]
  },
  {
    name: 'min DP 10',
    filters: { minDp: 10 },
    expected: [...without(SNV, 'chr1:400'), ...SV, ...CNV, ...STR]
  },
  {
    name: 'BED regions',
    filters: { bedPadding: 0 },
    bed: true,
    // chr1:900 (bad GT) is outside the regions: filtered, so its genotype is never read.
    skipped: 2,
    expected: [
      'chr1:100',
      'chr1:200',
      'chr1:1000000',
      'chr22:29000000',
      'chr1:5000000',
      'chr21:43776444'
    ]
  }
]

describe('VCF import filters: every file, both backends', () => {
  let dir: string
  let files: Array<{ filePath: string; variantType: string }>
  let bedPath: string

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'varlens-filter-parity-'))
    const snvPath = join(dir, 'snv.vcf')
    writeFileSync(snvPath, SNV_VCF)
    bedPath = join(dir, 'regions.bed')
    writeFileSync(bedPath, BED)
    files = [
      { filePath: snvPath, variantType: 'snv-indel' },
      { filePath: resolve(VCF_DIR, 'synthetic-sv.vcf'), variantType: 'sv' },
      { filePath: resolve(VCF_DIR, 'synthetic-cnv.vcf'), variantType: 'cnv' },
      { filePath: resolve(VCF_DIR, 'synthetic-str.vcf'), variantType: 'str' }
    ]
  })

  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  /** The same files with each one first in turn. */
  const rotations = (): Array<typeof files> =>
    files.map((_, i) => [...files.slice(i), ...files.slice(0, i)])

  const filtersOf = (c: FilterCase): FileImportRequest['vcfFilters'] =>
    c.bed === true ? { ...c.filters, bedFilePath: bedPath } : c.filters

  describe('SQLite (worker for file 1, append path for files 2..N)', () => {
    async function importSqlite(
      order: typeof files,
      vcfFilters: FileImportRequest['vcfFilters']
    ): Promise<{ rows: string[]; skipped: number }> {
      const dbPath = join(dir, `${randomBytes(6).toString('hex')}.db`)
      const svc = new DatabaseService(dbPath)
      let skipped: number
      try {
        // Let the startup cache cleanup release its connection first.
        await new Promise<void>((done) => setImmediate(done))
        const messages: WorkerMessage[] = []
        await runImportSession(
          {
            type: 'start',
            dbPath,
            files: [
              {
                filePath: order[0].filePath,
                caseName: 'parity',
                isDuplicate: false,
                duplicateStrategy: 'skip',
                vcfSelectedSamples: [SAMPLE],
                vcfFilters
              }
            ],
            throttleMs: 0
          },
          { postMessage: (m) => messages.push(m) }
        )
        const first = messages.find((m) => m.type === 'file-complete')
        if (first?.type !== 'file-complete') {
          throw new Error(`first file failed: ${JSON.stringify(messages.at(-1))}`)
        }
        skipped = first.result.skipped
        const importFilters = await loadImportFilters(vcfFilters)
        svc.variants.beginBulkInsert()
        for (const file of order.slice(1)) {
          const result = await importAdditionalFileToCase(
            first.result.caseId,
            file.filePath,
            { selectedSample: SAMPLE },
            () => svc,
            {},
            importFilters
          )
          skipped += result.skipped
        }
        svc.variants.finishBulkInsertNoCount()
      } finally {
        svc.close()
      }
      const db = new Database(dbPath, { readonly: true })
      try {
        const rows = db.prepare('SELECT chr, pos FROM variants').all() as Array<{
          chr: string
          pos: number
        }>
        return { rows: rows.map((r) => `${r.chr}:${r.pos}`), skipped }
      } finally {
        db.close()
      }
    }

    it.each(CASES)(
      '$name',
      async (c) => {
        for (const order of rotations()) {
          const result = await importSqlite(order, filtersOf(c))
          expect(result.rows.sort(), `first file ${order[0].variantType}`).toEqual(
            [...c.expected].sort()
          )
          // Only the unreadable rows are "skipped"; filtered and hom-ref records are not.
          expect(result.skipped, `first file ${order[0].variantType}`).toBe(c.skipped ?? 3)
        }
      },
      120_000
    )
  })

  describe.skipIf(!RUN_PG)('PostgreSQL (real instance)', () => {
    const schema = `varlens_test_filter_parity_${Date.now()}_${randomBytes(4).toString('hex')}`
    let probe: Client

    beforeAll(async () => {
      probe = new Client({ connectionString: PG_URL })
      await probe.connect()
      await probe.query(`CREATE SCHEMA "${schema}"`)
      const pool = new Pool({ connectionString: PG_URL, max: 2 })
      await new PostgresMigrationRunner(pool, schema, POSTGRES_MIGRATIONS).migrate()
      await pool.end()
    }, 60_000)

    afterAll(async () => {
      if (!probe) return
      await probe.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
      await probe.end()
    }, 60_000)

    async function importPostgres(
      order: typeof files,
      vcfFilters: FileImportRequest['vcfFilters']
    ): Promise<{ rows: string[]; skipped: number }> {
      const messages: PostgresImportWorkerOutboundMessage[] = []
      await runImport(
        {
          createClient: (config) => new Client(config),
          detectFormat,
          createMapperPipeline,
          statFile: (path) => ({ size: statSync(path).size }),
          createVcfMappedStream: async (filePath, options) =>
            streamMappedVcfRows(filePath, options.selectedSample, options.filters, options.onSkip)
        },
        {
          type: 'start',
          client: { connectionString: PG_URL },
          schema,
          mode: 'multi-file',
          caseName: `parity-${randomBytes(6).toString('hex')}`,
          vcfOptions: { selectedSample: SAMPLE, genomeBuild: 'GRCh38' },
          files: order.map((file) => ({ ...file, caller: null, annotationFormat: null })),
          filters: vcfFilters
        },
        (m) => messages.push(m)
      )
      const last = messages.at(-1)
      if (last?.type !== 'complete') throw new Error(`import failed: ${JSON.stringify(last)}`)
      const result = await probe.query<{ chr: string; pos: string }>(
        `SELECT chr, pos FROM "${schema}"."variants" WHERE case_id = $1`,
        [last.result.caseId]
      )
      return {
        rows: result.rows.map((r) => `${r.chr}:${r.pos}`),
        skipped: last.result.skipped
      }
    }

    it.each(CASES)(
      '$name',
      async (c) => {
        for (const order of rotations()) {
          const result = await importPostgres(order, filtersOf(c))
          expect(result.rows.sort(), `first file ${order[0].variantType}`).toEqual(
            [...c.expected].sort()
          )
          expect(result.skipped, `first file ${order[0].variantType}`).toBe(c.skipped ?? 3)
        }
      },
      120_000
    )
  })
})
