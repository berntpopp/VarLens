// @vitest-environment node
/**
 * One multi-file VCF import (SNV + SV + CNV + STR into one case) keeps the same
 * records on SQLite and on PostgreSQL, whichever file comes first. Every
 * expectation is written out per filter with allele, type, genotype, GQ and DP,
 * so a filter that wipes out a callset, reads another sample's column or stops
 * applying to one variant type fails here.
 *
 * Both backends are entered through `startMultiFileImport` and their real
 * executor; only the worker thread is replaced by the same worker code run
 * in-process. PostgreSQL needs a real instance and is gated by
 * VARLENS_RUN_POSTGRES_E2E=1 (with a reachable VARLENS_PG_URL).
 */
import { randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import Database from 'better-sqlite3-multiple-ciphers'
import { Client, Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { DatabaseService } from '../../../src/main/database/DatabaseService'
import { detectFormat } from '../../../src/main/import/format-detection'
import { loadImportFilters } from '../../../src/main/import/vcf/import-filters'
import { POSTGRES_MIGRATIONS } from '../../../src/main/storage/postgres/migrations/definitions'
import { PostgresMigrationRunner } from '../../../src/main/storage/postgres/migrations/PostgresMigrationRunner'
import { PostgresImportExecutor } from '../../../src/main/storage/postgres/PostgresImportExecutor'
import { SqliteImportExecutor } from '../../../src/main/storage/sqlite/SqliteImportExecutor'
import { createMapperPipeline } from '../../../src/main/workers/import-pipeline'
import { runImportSession } from '../../../src/main/workers/import-worker'
import { runImport, streamMappedVcfRows } from '../../../src/main/workers/postgres-import-worker'

// The cohort summary rebuild after an append runs in a worker thread of the
// built bundle; it has its own test (import-logic-multifile-summary.test.ts).
vi.mock('../../../src/main/ipc/handlers/cohort-logic', () => ({
  spawnRebuildWorker: vi.fn(async () => undefined)
}))

const { startMultiFileImport } = await import('../../../src/main/ipc/handlers/import-logic')

const RUN_PG = process.env.VARLENS_RUN_POSTGRES_E2E === '1'
const PG_URL =
  process.env.VARLENS_PG_URL ??
  'postgres://varlens:varlens_dev_password@127.0.0.1:55432/varlens_dev'

const VCF_DIR = resolve(__dirname, '../../test-data/vcf')

const vcf = (samples: string, rows: string[], extraHeader: string[] = []): string =>
  [
    '##fileformat=VCFv4.2',
    ...extraHeader,
    '##INFO=<ID=END,Number=1,Type=Integer,Description="End">',
    '##INFO=<ID=SVTYPE,Number=1,Type=String,Description="Type">',
    '##FORMAT=<ID=GT,Number=1,Type=String,Description="Genotype">',
    '##FORMAT=<ID=GQ,Number=1,Type=Integer,Description="Genotype quality">',
    '##FORMAT=<ID=DP,Number=1,Type=Integer,Description="Depth">',
    `#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\t${samples}`,
    ...rows,
    ''
  ].join('\n')

// Two samples with opposing values: the case is sample A. Wherever A passes a
// threshold B fails it and the reverse, so reading B's column shows up.
const SNV_VCF = vcf('A\tB', [
  'chr1\t100\t.\tA\tT\t50\tPASS\t.\tGT:GQ:DP\t0/1:40:30\t0/1:5:3', // passes every filter
  'chr1\t200\t.\tC\tG\t50\tLowQual\t.\tGT:GQ:DP\t0/1:40:30\t0/1:40:30', // fails PASS-only
  'chr1\t300\t.\tG\tA\t5\tPASS\t.\tGT:GQ:DP\t0/1:40:30\t0/1:40:30', // fails min QUAL
  'chr1\t400\t.\tT\tC\t50\tPASS\t.\tGT:GQ:DP\t0/1:40:3\t0/1:40:30', // fails min DP
  'chr1\t500\t.\tA\tG\t50\tPASS\t.\tGT:GQ:DP\t0/1:5:30\t0/1:40:30', // fails min GQ
  'chr1\t600\t.\tC\tT\t.\t.\t.\tGT:GQ:DP\t0/1:.:.\t0/1:5:3', // nothing to judge: always kept
  'chr3\t100\t.\tA\tG\t50\tPASS\t.\tGT:GQ:DP\t0/0:40:30\t0/1:40:30', // hom-ref in A: no variant
  // The three unreadable rows; each must be counted as skipped on every path.
  'chr1\t700\t.\tA', // truncated
  'chr1\t800\t.\tA\tT\t50\tPASS\t.', // no FORMAT and sample columns
  'chr1\t900\t.\tA\tT\t50\tPASS\t.\tGT:GQ:DP\t0/2:40:30\t0/1:40:30' // GT names an allele the row lacks
])

// The same two samples in the other column order.
const SWAPPED_VCF = vcf('B\tA', [
  'chr5\t100\t.\tA\tT\t50\tPASS\t.\tGT:GQ:DP\t0/1:5:3\t0/1:40:30',
  'chr5\t200\t.\tC\tG\t50\tPASS\t.\tGT:GQ:DP\t0/1:40:30\t0/1:5:3', // A fails min GQ and min DP
  'chr5\t300\t.\tG\tA\t50\tPASS\t.\tGT:GQ:DP\t0/1:40:30\t0/0:40:30', // only B carries it
  'chr5\t400\t.\tT\tC\t50\tPASS\t.\tGT:GQ:DP\t0/0:40:30\t1/1:40:30' // only A carries it
])

// SV, CNV and STR records that do carry FORMAT/DP, one failing and one passing
// each. A single-sample file under another name: it is still the case's file.
const DEPTH_VCF = vcf('SAMPLE', [
  'chr7\t1000\t.\tN\t<DEL>\t.\tPASS\tSVTYPE=DEL;END=2000\tGT:GQ:DP\t0/1:40:3',
  'chr7\t5000\t.\tN\t<DEL>\t.\tPASS\tSVTYPE=DEL;END=6000\tGT:GQ:DP\t0/1:40:30',
  'chr7\t10000\t.\tN\t<CNV>\t.\tPASS\tSVTYPE=CNV;END=20000\tGT:GQ:DP\t0/1:40:3',
  'chr7\t30000\t.\tN\t<CNV>\t.\tPASS\tSVTYPE=CNV;END=40000\tGT:GQ:DP\t0/1:40:30',
  'chr7\t50000\t.\tC\t<STR12>\t.\tPASS\tEND=50030\tGT:GQ:DP\t0/1:40:3',
  'chr7\t60000\t.\tC\t<STR12>\t.\tPASS\tEND=60030\tGT:GQ:DP\t0/1:40:30'
])

const GRCH37_VCF = vcf(
  'A',
  ['chr9\t100\t.\tA\tT\t50\tPASS\t.\tGT:GQ:DP\t0/1:40:30'],
  ['##reference=file:///ref/GRCh37.fa']
)

// 0-based half-open. The chr22, chr21 and chr7 regions hit their record only
// through its POS..END interval, not through POS.
const BED = [
  'chr1\t0\t250',
  'chr5\t0\t150',
  'chr7\t1500\t1600',
  'chr1\t999000\t1010000',
  'chr1\t5000000\t5600000',
  'chr22\t29010000\t29010100',
  'chr21\t43776460\t43776470',
  ''
].join('\n')

// chr:pos:ref>alt type genotype GQ/DP of the case's sample.
const ROWS = {
  snv: [
    'chr1:100:A>T snv 0/1 40/30',
    'chr1:200:C>G snv 0/1 40/30',
    'chr1:300:G>A snv 0/1 40/30',
    'chr1:400:T>C snv 0/1 40/3',
    'chr1:500:A>G snv 0/1 5/30',
    'chr1:600:C>T snv 0/1 null/null'
  ],
  swapped: ['chr5:100:A>T snv 0/1 40/30', 'chr5:200:C>G snv 0/1 5/3', 'chr5:400:T>C snv 1/1 40/30'],
  depth: [
    'chr7:1000:N><DEL> sv 0/1 40/3',
    'chr7:5000:N><DEL> sv 0/1 40/30',
    'chr7:10000:N><CNV> cnv 0/1 40/3',
    'chr7:30000:N><CNV> cnv 0/1 40/30',
    'chr7:50000:C><STR12> str 0/1 40/3',
    'chr7:60000:C><STR12> str 0/1 40/30'
  ],
  // Sniffles2: QUAL, FILTER and FORMAT/GQ set, no FORMAT/DP.
  sv: [
    'chr1:1000000:N><DEL> sv 0/1 40/null',
    'chr1:2000000:C>CAAAAAAAAAA sv 1/1 50/null',
    'chr22:29000000:N><DUP> sv 0/1 20/null',
    'chr2:5000000:N><INV> sv 0/1 5/null',
    'chr1:9000000:N>]chr2:3000000]N sv 0/1 30/null'
  ],
  // Spectre: QUAL '.', all PASS, FORMAT/GQ set, no FORMAT/DP.
  cnv: [
    'chr1:5000000:N><DEL> cnv 0/1 30/null',
    'chr1:10000000:N><DUP> cnv 0/1 25/null',
    'chr22:29500000:N><DEL> cnv 1/1 40/null'
  ],
  // Straglr: QUAL '.', no GQ, no DP; chr14 is one row with two alleles (GT 1/2),
  // each stored with the other allele blanked.
  str: [
    'chr14:92071010:C><STR24> str 1/. null/null',
    'chr14:92071010:C><STR15> str ./1 null/null',
    'chr21:43776444:C><STR50> str 1/1 null/null',
    'chr1:149390803:G><STR17> str 1/1 null/null'
  ]
}
const ALL = Object.values(ROWS).flat()
type FileKey = keyof typeof ROWS
/** Checked-in caller fixtures; the other files are written by this test. */
const SHIPPED: Record<string, string> = {
  sv: 'synthetic-sv.vcf',
  cnv: 'synthetic-cnv.vcf',
  str: 'synthetic-str.vcf'
}
const LONE: FileKey[] = ['depth', 'sv', 'cnv', 'str']
/** File orders that put every kind of file first once. */
const ORDERS: Array<{ keys: FileKey[]; vcfOptions?: { selectedSample: string } }> = [
  // A two-sample file first: the sample is selected, as the per-sample wizard does.
  { keys: ['snv', 'swapped', ...LONE], vcfOptions: { selectedSample: 'A' } },
  { keys: ['swapped', 'snv', ...LONE], vcfOptions: { selectedSample: 'A' } },
  // Each single-sample callset first, with no sample, as the import dialog sends it.
  ...LONE.map((_, i) => ({ keys: [...LONE.slice(i), ...LONE.slice(0, i)] }))
]

const at = (row: string, positions: string[]): boolean =>
  positions.some((position) => row.startsWith(`${position}:`))
const without = (...positions: string[]): string[] => ALL.filter((row) => !at(row, positions))
const only = (...positions: string[]): string[] => ALL.filter((row) => at(row, positions))

interface FilterCase {
  name: string
  filters?: { passOnly?: boolean; minQual?: number; minGq?: number; minDp?: number }
  bed?: true
  expected: string[]
  /** Unreadable rows counted; 3 unless a filter drops a row before its genotype is read. */
  skipped?: number
}

const CASES: FilterCase[] = [
  { name: 'no filters', expected: ALL },
  {
    name: 'PASS only',
    filters: { passOnly: true },
    expected: without('chr1:200', 'chr2:5000000', 'chr1:149390803')
  },
  {
    // QUAL '.' is not a failing score: the CNV, STR and depth callsets survive.
    name: 'min QUAL 20',
    filters: { minQual: 20 },
    expected: without('chr1:300', 'chr2:5000000')
  },
  {
    // A numeric GQ is compared whatever the variant type; no GQ (STR) is kept.
    name: 'min GQ 35',
    filters: { minGq: 35 },
    expected: without(
      'chr1:500',
      'chr5:200',
      'chr22:29000000',
      'chr2:5000000',
      'chr1:9000000',
      'chr1:5000000',
      'chr1:10000000'
    )
  },
  {
    // A numeric DP is compared whatever the variant type; no DP is kept.
    name: 'min DP 10',
    filters: { minDp: 10 },
    expected: without('chr1:400', 'chr5:200', 'chr7:1000', 'chr7:10000', 'chr7:50000')
  },
  {
    name: 'BED regions',
    bed: true,
    expected: only(
      'chr1:100',
      'chr1:200',
      'chr5:100',
      'chr7:1000',
      'chr1:1000000',
      'chr22:29000000',
      'chr1:5000000',
      'chr21:43776444'
    ),
    // chr1:900 (bad GT) is outside the regions: filtered, so its genotype is never read.
    skipped: 2
  }
]

interface ImportOutcome {
  rows: string[]
  skipped: number
  /** Error of each file, by file name; absent for a file that imported. */
  errors: Record<string, string>
}

interface FileSpec {
  filePath: string
  variantType: string
  caller: null
  annotationFormat: null
}

type VcfOptions = { selectedSample?: string; genomeBuild?: string }
type Backend = (
  files: FileSpec[],
  c: FilterCase | undefined,
  vcfOptions: VcfOptions | undefined
) => Promise<ImportOutcome>

const ROW_SQL = `SELECT chr, pos, ref, alt, variant_type, gt_num, gq, dp FROM variants`
const rowText = (r: Record<string, unknown>): string =>
  `${r.chr}:${r.pos}:${r.ref}>${r.alt} ${r.variant_type} ${r.gt_num} ${r.gq}/${r.dp}`

describe('VCF import filters: every file, both backends', () => {
  let dir: string
  let bedPath: string
  const file = (key: FileKey | 'grch37'): FileSpec => ({
    filePath: key in SHIPPED ? resolve(VCF_DIR, SHIPPED[key]) : join(dir, `${key}.vcf`),
    variantType: 'auto',
    caller: null,
    annotationFormat: null
  })

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'varlens-filter-parity-'))
    writeFileSync(join(dir, 'snv.vcf'), SNV_VCF)
    writeFileSync(join(dir, 'swapped.vcf'), SWAPPED_VCF)
    writeFileSync(join(dir, 'depth.vcf'), DEPTH_VCF)
    writeFileSync(join(dir, 'grch37.vcf'), GRCH37_VCF)
    bedPath = join(dir, 'regions.bed')
    writeFileSync(bedPath, BED)
  })

  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  /** The filter payload as the import dialog sends it. */
  const payloadOf = (c: FilterCase | undefined): Record<string, unknown> | undefined =>
    c === undefined || (c.filters === undefined && c.bed !== true)
      ? undefined
      : { ...c.filters, bedPadding: 0, bedFile: c.bed === true ? bedPath : null }

  const outcomeOf = (
    rows: Array<Record<string, unknown>>,
    result: { totalSkipped: number; files: Array<{ filePath: string; error?: string }> }
  ): ImportOutcome => ({
    rows: rows.map(rowText).sort(),
    skipped: result.totalSkipped,
    errors: Object.fromEntries(
      result.files
        .filter((f) => f.error !== undefined)
        .map((f) => [f.filePath.split('/').pop(), f.error])
    )
  })

  const importSqlite: Backend = async (files, c, vcfOptions) => {
    const dbPath = join(dir, `${randomBytes(6).toString('hex')}.db`)
    const svc = new DatabaseService(dbPath)
    try {
      // Let the startup cache cleanup release its connection first.
      await new Promise<void>((done) => setImmediate(done))
      const executor = new SqliteImportExecutor({
        getDatabaseService: () => svc,
        // The import worker's own session code, without the thread.
        createWorkerClient: () =>
          ({
            start: (request: Record<string, unknown>) => {
              const on = request as unknown as Record<string, (m: unknown) => void>
              void runImportSession({ type: 'start', ...request } as never, {
                postMessage: (m) => {
                  if (m.type === 'file-complete') on.onFileComplete(m)
                  else if (m.type === 'complete') on.onComplete(m)
                  else if (m.type === 'error') on.onError(m)
                }
              })
            },
            cancel: () => undefined
          }) as never
      })
      const session = { capabilities: { backend: 'sqlite' }, getImportExecutor: () => executor }
      const payload = payloadOf(c)
      const result = await startMultiFileImport(
        'parity',
        files,
        vcfOptions,
        () => session as never,
        () => svc,
        {},
        // What the IPC handler builds for the append path from the same payload.
        await loadImportFilters(
          payload === undefined ? undefined : { ...payload, bedFilePath: payload.bedFile as string }
        ),
        payload as never
      )
      const db = new Database(dbPath, { readonly: true })
      try {
        return outcomeOf(db.prepare(ROW_SQL).all() as Array<Record<string, unknown>>, result)
      } finally {
        db.close()
      }
    } finally {
      svc.close()
    }
  }

  /** The contract of both backends. */
  function contract(importCase: Backend): void {
    it.each(CASES)(
      '$name',
      async (c) => {
        for (const { keys, vcfOptions } of ORDERS) {
          const first = `first file ${keys[0]}`
          const outcome = await importCase(keys.map(file), c, vcfOptions)
          expect(outcome.errors, first).toEqual({})
          expect(outcome.rows, first).toEqual(
            c.expected.filter((row) => keys.some((key) => ROWS[key].includes(row))).sort()
          )
          // Only unreadable rows (all in snv.vcf) are "skipped"; filtered and
          // hom-ref records are not.
          expect(outcome.skipped, first).toBe(keys.includes('snv') ? (c.skipped ?? 3) : 0)
        }
      },
      180_000
    )

    it('reads the sample of the first file in every file when none is selected', async () => {
      // The import dialog sends no sample: file 1 lists A first, file 2 lists B first.
      const outcome = await importCase(
        [file('snv'), file('swapped'), file('depth')],
        { name: '', filters: { minGq: 35, minDp: 10 }, expected: [] },
        undefined
      )
      expect(outcome.errors).toEqual({})
      expect(outcome.rows).toEqual(
        [...ROWS.snv, ...ROWS.swapped, ...ROWS.depth]
          .filter(
            (row) =>
              !at(row, [
                'chr1:400',
                'chr1:500',
                'chr5:200',
                'chr7:1000',
                'chr7:10000',
                'chr7:50000'
              ])
          )
          .sort()
      )
    }, 60_000)

    it('rejects a multi-sample file that does not have the case sample', async () => {
      const outcome = await importCase([file('sv'), file('snv')], undefined, undefined)
      expect(outcome.errors).toEqual({
        'snv.vcf': expect.stringMatching(/sample "SAMPLE1" is not present.*A, B/)
      })
      expect(outcome.rows).toEqual([...ROWS.sv].sort())
    }, 60_000)

    it('rejects a file of another reference assembly before inserting its rows', async () => {
      const outcome = await importCase([file('snv'), file('grch37')], undefined, {
        genomeBuild: 'GRCh38'
      })
      expect(outcome.errors).toEqual({
        'grch37.vcf': expect.stringMatching(
          /Genome build mismatch: case is locked to GRCh38 but .*grch37\.vcf declares GRCh37/
        )
      })
      expect(outcome.rows).toEqual([...ROWS.snv].sort())
    }, 60_000)
  }

  describe('SQLite', () => contract(importSqlite))

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

    const importPostgres: Backend = async (files, c, vcfOptions) => {
      const executor = new PostgresImportExecutor({
        schema,
        clientConfig: { connectionString: PG_URL },
        // The import worker's own code, without the thread.
        workerClientFactory: () =>
          ({
            start: (message: never, on: Record<string, (m: unknown) => void>) => {
              void runImport(
                {
                  createClient: (config) => new Client(config),
                  detectFormat,
                  createMapperPipeline,
                  statFile: (path) => ({ size: statSync(path).size }),
                  createVcfMappedStream: async (filePath, options) =>
                    streamMappedVcfRows(
                      filePath,
                      options.selectedSample,
                      options.filters,
                      options.onSkip,
                      options.appendedTo
                    )
                },
                message,
                (m) => {
                  if (m.type === 'complete') on.onComplete(m)
                  else if (m.type === 'error') on.onError(m)
                }
              )
            },
            cancel: () => undefined,
            terminate: async () => undefined
          }) as never
      })
      const session = { capabilities: { backend: 'postgres' }, getImportExecutor: () => executor }
      const result = await startMultiFileImport(
        `parity-${randomBytes(6).toString('hex')}`,
        files,
        vcfOptions,
        () => session as never,
        () => {
          throw new Error('no SQLite database on the PostgreSQL path')
        },
        {},
        undefined,
        payloadOf(c) as never
      )
      const rows = await probe.query(
        `${ROW_SQL.replace('variants', `"${schema}"."variants"`)} WHERE case_id = $1`,
        [result.caseId]
      )
      return outcomeOf(rows.rows, result)
    }

    contract(importPostgres)
  })
})
