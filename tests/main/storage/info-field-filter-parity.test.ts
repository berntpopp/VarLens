// @vitest-environment node
/**
 * `info.<KEY>` case filters over custom VCF INFO values (#538) must select the
 * same rows on both backends: absent keys, the VCF missing value `.`, numeric
 * zero, text, lists and flags are told apart, numbers compare numerically and
 * nothing is coerced. SQLite always; PostgreSQL when
 * VARLENS_RUN_POSTGRES_E2E=1 (`make pg-up`).
 */
import { randomBytes } from 'node:crypto'

import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { DatabaseService } from '../../../src/main/database'
import { POSTGRES_MIGRATIONS } from '../../../src/main/storage/postgres/migrations/definitions'
import { PostgresMigrationRunner } from '../../../src/main/storage/postgres/migrations/PostgresMigrationRunner'
import { PostgresCohortRepository } from '../../../src/main/storage/postgres/PostgresCohortRepository'
import { PostgresExportRepository } from '../../../src/main/storage/postgres/PostgresExportRepository'
import { PostgresVariantReadRepository } from '../../../src/main/storage/postgres/PostgresVariantReadRepository'
import type { ColumnFiltersParam } from '../../../src/shared/types/column-filters'

const RUN_PG = process.env.VARLENS_RUN_POSTGRES_E2E === '1'
const PG_URL =
  process.env.VARLENS_PG_URL ??
  'postgres://varlens:varlens_dev_password@127.0.0.1:55432/varlens_dev'

/** pos → info_json exactly as the VCF importer stores it (raw strings). */
const ROWS: Array<[number, Record<string, string> | null]> = [
  [100, { DP: '0', TXT: 'abc', LIST: '1,2', FLAG: '' }],
  [200, { DP: '.' }],
  [300, null],
  [400, { DP: '35', TXT: 'ABCdef' }],
  [500, { DP: '7.5', TXT: '35' }],
  [600, { DP: 'abc' }],
  [700, { DP: '1e5000' }],
  [800, { DP: '0.0', 'A.B': 'x' }],
  // Not JSON numbers: never numeric on either backend.
  [900, { DP: '.5' }],
  [1000, { DP: '01' }]
]

const f = (filters: ColumnFiltersParam): ColumnFiltersParam => filters

const EXPECTED: Array<[string, ColumnFiltersParam, number[]]> = [
  ['numeric zero', f({ 'info.DP': { operator: '=', value: '0' } }), [100, 800]],
  ['numeric zero (number value)', f({ 'info.DP': { operator: '=', value: 0 } }), [100, 800]],
  ['absent or missing', f({ 'info.DP': { operator: 'is_null', value: '' } }), [200, 300]],
  [
    'has a value',
    f({ 'info.DP': { operator: 'not_null', value: '' } }),
    [100, 400, 500, 600, 700, 800, 900, 1000]
  ],
  ['explicit missing only', f({ 'info.DP': { operator: '=', value: '.' } }), [200]],
  ['greater than', f({ 'info.DP': { operator: '>', value: 1 } }), [400, 500]],
  ['at most zero', f({ 'info.DP': { operator: '<=', value: 0 } }), [100, 800]],
  ['not equal', f({ 'info.DP': { operator: '!=', value: '0' } }), [400, 500, 600, 700, 900, 1000]],
  ['text equality', f({ 'info.DP': { operator: '=', value: 'abc' } }), [600]],
  [
    'numeric-looking text matches as text',
    f({ 'info.DP': { operator: '=', value: '01' } }),
    [1000]
  ],
  ['range skips non-JSON numbers', f({ 'info.DP': { operator: '>', value: 0 } }), [400, 500]],
  ['contains, case-insensitive', f({ 'info.TXT': { operator: 'like', value: 'abc' } }), [100, 400]],
  ['numeric value on a text field', f({ 'info.TXT': { operator: '=', value: '35' } }), [500]],
  ['in', f({ 'info.DP': { operator: 'in', value: ['0', '35'] } }), [100, 400, 800]],
  ['list never compares as a number', f({ 'info.LIST': { operator: '>', value: 0 } }), []],
  ['flag present', f({ 'info.FLAG': { operator: 'not_null', value: '' } }), [100]],
  ['dotted key', f({ 'info.A.B': { operator: '=', value: 'x' } }), [800]],
  [
    'with a base filter',
    f({ 'info.DP': { operator: '>=', value: 0 }, pos: { operator: '>', value: 450 } }),
    [500, 800]
  ]
]

const REJECTED: Array<[string, ColumnFiltersParam, string]> = [
  ['list value', f({ 'info.LIST': { operator: '=', value: '1,2' } }), 'list values'],
  ['text range bound', f({ 'info.DP': { operator: '>', value: 'abc' } }), 'needs a number'],
  ['invalid key', f({ "info.D'P": { operator: '=', value: '1' } }), 'not a valid INFO field'],
  ['empty key', f({ 'info.': { operator: 'is_null', value: '' } }), 'not a valid INFO field']
]

const positions = (rows: Array<{ pos: unknown }>): number[] =>
  rows.map((r) => Number(r.pos)).sort((a, b) => a - b)

describe('info.<KEY> case filters — SQLite (#538)', () => {
  let sqlite: DatabaseService
  let caseId: number

  beforeAll(() => {
    sqlite = new DatabaseService(':memory:')
    caseId = sqlite.cases.createCase('info', '/tmp/info.vcf', 0, 'GRCh38')
    sqlite.variants.insertVariantsBatch(
      caseId,
      ROWS.map(
        ([pos, info]) =>
          ({
            chr: '1',
            pos,
            ref: 'A',
            alt: 'T',
            variant_type: 'snv',
            gt_num: '0/1',
            info_json: info === null ? null : JSON.stringify(info)
          }) as never
      )
    )
    sqlite.cohortSummary.rebuild()
  })

  afterAll(() => sqlite.close())

  it.each(EXPECTED)('%s', (_name, column_filters, expected) => {
    const filter = { case_id: caseId, column_filters }
    const page = sqlite.variants.getVariants(filter, 100)
    expect(positions(page.data)).toEqual(expected)
    expect(page.total_count).toBe(expected.length)
    expect(positions(sqlite.variants.getAllVariantsForExport(filter))).toEqual(expected)
  })

  it.each(REJECTED)('rejects %s', (_name, column_filters, message) => {
    expect(() => sqlite.variants.getVariants({ case_id: caseId, column_filters }, 100)).toThrow(
      message
    )
  })

  it('filters info.* in the cohort view (#639)', () => {
    const res = sqlite.cohort.getCohortVariants({
      column_filters: { 'info.DP': { operator: '=', value: '0' } }
    })
    expect(positions(res.data)).toEqual([100, 800])
  })
})

describe.skipIf(!RUN_PG)('info.<KEY> case filters — PostgreSQL (#538)', () => {
  let schema: string
  let pool: Pool
  let caseId: number

  beforeAll(async () => {
    schema = `vt_info_${randomBytes(4).toString('hex')}`
    pool = new Pool({ connectionString: PG_URL, max: 2 })
    await pool.query(`CREATE SCHEMA "${schema}"`)
    await new PostgresMigrationRunner(pool, schema, POSTGRES_MIGRATIONS).migrate()
    const caseRow = await pool.query<{ id: number }>(
      `INSERT INTO "${schema}".cases (name, file_path, file_size, created_at, genome_build)
         VALUES ('info', '/tmp/info.vcf', 0, $1, 'GRCh38') RETURNING id`,
      [Date.now()]
    )
    caseId = caseRow.rows[0].id
    for (const [pos, info] of ROWS) {
      await pool.query(
        `INSERT INTO "${schema}".variants
           (case_id, chr, pos, ref, alt, variant_type, gt_num, info_json)
           VALUES ($1, '1', $2, 'A', 'T', 'snv', '0/1', $3)`,
        [caseId, pos, info === null ? null : JSON.stringify(info)]
      )
    }
  }, 120_000)

  afterAll(async () => {
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    await pool.end()
  }, 120_000)

  it.each(EXPECTED)(
    '%s',
    async (_name, column_filters, expected) => {
      const filter = { case_id: caseId, column_filters }
      const page = await new PostgresVariantReadRepository(pool, schema).queryVariants(filter, 100)
      expect(positions(page.data)).toEqual(expected)
      expect(page.total_count).toBe(expected.length)
      const rows: Array<{ pos: unknown }> = []
      for await (const row of new PostgresExportRepository(pool, schema).streamVariantRows(filter))
        rows.push(row as { pos: unknown })
      expect(positions(rows)).toEqual(expected)
    },
    60_000
  )

  it.each(REJECTED)(
    'rejects %s',
    async (_name, column_filters, message) => {
      await expect(
        new PostgresVariantReadRepository(pool, schema).queryVariants(
          { case_id: caseId, column_filters },
          100
        )
      ).rejects.toThrow(message)
    },
    60_000
  )

  it('accepts info.* in the cohort view (#639)', async () => {
    const res = await new PostgresCohortRepository(pool, schema).queryVariants({
      column_filters: { 'info.DP': { operator: '=', value: '0' } }
    })
    expect(Array.isArray(res.data)).toBe(true)
  }, 60_000)
})
