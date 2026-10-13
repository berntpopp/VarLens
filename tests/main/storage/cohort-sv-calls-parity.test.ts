/**
 * Cohort SV/CNV call context (#573, #539) on both backends: cohort rows carry
 * End / type / unsigned length as summary facts (sortable, filterable, with
 * column metadata), and each carrier the metrics of ONE of its calls. SQLite
 * always runs; PostgreSQL (same fixture, same expectations) with
 * VARLENS_RUN_POSTGRES_E2E=1 (`make pg-up`).
 */
import { randomBytes } from 'node:crypto'

import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { DatabaseService } from '../../../src/main/database'
import { POSTGRES_MIGRATIONS } from '../../../src/main/storage/postgres/migrations/definitions'
import { PostgresMigrationRunner } from '../../../src/main/storage/postgres/migrations/PostgresMigrationRunner'
import { PostgresCohortRepository } from '../../../src/main/storage/postgres/PostgresCohortRepository'
import { PostgresCohortSummaryRepository } from '../../../src/main/storage/postgres/PostgresCohortSummaryRepository'
import { PostgresVariantReadRepository } from '../../../src/main/storage/postgres/PostgresVariantReadRepository'
import type { ColumnFiltersParam } from '../../../src/shared/types/column-filters'
import type { SortItem } from '../../../src/shared/types/database'
import type { ColumnFilterMeta } from '../../../src/shared/types/column-filters'
import type {
  CohortCarrier,
  CohortSearchParams,
  CohortVariant,
  CohortVariantIdentity
} from '../../../src/shared/types/cohort'

const RUN_PG = process.env.VARLENS_RUN_POSTGRES_E2E === '1'
const PG_URL =
  process.env.VARLENS_PG_URL ??
  'postgres://varlens:varlens_dev_password@127.0.0.1:55432/varlens_dev'

interface Call {
  chr: string
  pos: number
  alt: string
  variant_type: 'sv' | 'cnv' | 'snv'
  end_pos: number | null
  sv_type: string | null
  sv_length: number | null
  qual: number
  filter: string
  caller: string | null
  gq: number | null
  dp: number | null
  sv?: { support: number; vaf: number }
  cnv?: { copy_number: number }
}

const DEL = {
  chr: 'chr1',
  pos: 1000,
  alt: '<DEL>',
  variant_type: 'sv',
  sv_type: 'DEL',
  filter: 'PASS',
  gq: 30,
  dp: 40
} as const

const CASES: Array<{ name: string; ready: boolean; calls: Call[] }> = [
  {
    name: 'sv-a',
    ready: true,
    calls: [
      // Two calls of one case at one site (two appended SV files): the
      // carrier shows the one with the highest end, whole.
      {
        ...DEL,
        end_pos: 3000,
        sv_length: -2000,
        qual: 99,
        caller: 'delly',
        sv: { support: 1, vaf: 0.9 }
      },
      {
        ...DEL,
        end_pos: 5000,
        sv_length: -4000,
        qual: 50,
        caller: 'manta',
        sv: { support: 12, vaf: 0.4 }
      },
      {
        chr: 'chr2',
        pos: 2000,
        alt: '<DUP>',
        variant_type: 'cnv',
        end_pos: 9000,
        sv_type: 'DUP',
        sv_length: 7000,
        qual: 10,
        filter: 'PASS',
        caller: 'cnvkit',
        gq: null,
        dp: null,
        cnv: { copy_number: 3 }
      },
      // An insertion without END (SVTYPE=INS;SVLEN=300): VcfMapper leaves end_pos NULL.
      {
        chr: 'chr4',
        pos: 400,
        alt: '<INS>',
        variant_type: 'sv',
        end_pos: null,
        sv_type: 'INS',
        sv_length: 300,
        qual: 20,
        filter: 'PASS',
        caller: 'manta',
        gq: null,
        dp: null
      },
      {
        chr: 'chr3',
        pos: 300,
        alt: 'T',
        variant_type: 'snv',
        end_pos: null,
        sv_type: null,
        sv_length: null,
        qual: 99,
        filter: 'PASS',
        caller: null,
        gq: 99,
        dp: 20
      }
    ]
  },
  {
    name: 'sv-b',
    ready: true,
    calls: [
      {
        ...DEL,
        end_pos: 4500,
        sv_length: -3500,
        qual: 20,
        caller: 'manta',
        sv: { support: 5, vaf: 0.2 }
      }
    ]
  },
  {
    // Still importing: neither its call nor its carrier row may show.
    name: 'sv-importing',
    ready: false,
    calls: [{ ...DEL, end_pos: 9000, sv_length: -8000, qual: 1, caller: 'x' }]
  }
]

const INSERT_VARIANT_COLUMNS =
  'case_id, chr, pos, ref, alt, variant_type, end_pos, sv_type, sv_length, qual, filter, caller, gq, dp, gt_num'

function variantValues(caseId: number, c: Call): unknown[] {
  return [
    caseId,
    c.chr,
    c.pos,
    'N',
    c.alt,
    c.variant_type,
    c.end_pos,
    c.sv_type,
    c.sv_length,
    c.qual,
    c.filter,
    c.caller,
    c.gq,
    c.dp,
    '0/1'
  ]
}

const callOf = (rows: CohortVariant[], pos: number) => {
  const row = rows.find((r) => r.pos === pos)
  return { end_pos: row?.end_pos, sv_type: row?.sv_type, sv_length: row?.sv_length }
}

// Case ids differ per backend; toEqual ignores the undefined key.
const withoutIds = (carriers: CohortCarrier[]) =>
  carriers.map((carrier) => ({ ...carrier, case_id: undefined }))

const identity = (chr: string, pos: number, alt: string, type: string): CohortVariantIdentity => ({
  chr,
  pos,
  ref: 'N',
  alt,
  variant_type: type,
  genome_build: 'GRCh38'
})

/** One backend, as the assertions see it. */
interface Backend {
  rows(params: CohortSearchParams): Promise<CohortVariant[]>
  carriers(variant: CohortVariantIdentity): Promise<CohortCarrier[]>
  meta(): Promise<ColumnFilterMeta[]>
  /** Case view of `sv-a`'s SV calls: the SV lengths in row order. */
  caseLengths(columnFilters?: ColumnFiltersParam, sortBy?: SortItem[]): Promise<number[]>
  caseMeta(column: string): Promise<ColumnFilterMeta>
}

function cohortCallAssertions(backend: () => Backend): void {
  const positions = async (params: CohortSearchParams): Promise<number[]> =>
    (await backend().rows({ variant_type: 'sv', ...params })).map((r) => r.pos)

  it('rows carry End, SV type and the unsigned length of the longest ready call', async () => {
    const sv = await backend().rows({ variant_type: 'sv' })
    // sv-importing's 9000 / 8000 must not count.
    expect(callOf(sv, 1000)).toEqual({ end_pos: 5000, sv_type: 'DEL', sv_length: 4000 })
    expect(callOf(sv, 400)).toEqual({ end_pos: null, sv_type: 'INS', sv_length: 300 })
    const cnv = await backend().rows({ variant_type: 'cnv' })
    expect(callOf(cnv, 2000)).toEqual({ end_pos: 9000, sv_type: 'DUP', sv_length: 7000 })
    const snv = await backend().rows({ variant_type: 'snv' })
    expect(callOf(snv, 300)).toEqual({ end_pos: null, sv_type: null, sv_length: null })
  })

  it('sorts and filters the cohort by End, type and length', async () => {
    expect(await positions({ sort_by: 'sv_length', sort_order: 'asc' })).toEqual([400, 1000])
    expect(await positions({ sort_by: 'sv_length', sort_order: 'desc' })).toEqual([1000, 400])
    expect(await positions({ sort_by: 'sv_type', sort_order: 'desc' })).toEqual([400, 1000])
    // NULL ends sort last in both directions.
    expect(await positions({ sort_by: 'end_pos', sort_order: 'asc' })).toEqual([1000, 400])
    const longCalls = { sv_length: { operator: '>=' as const, value: 1000 } }
    expect(await positions({ column_filters: longCalls })).toEqual([1000])
    const insertions = { sv_type: { operator: '=' as const, value: 'INS' } }
    expect(await positions({ column_filters: insertions })).toEqual([400])
  })

  it('reports column metadata for End, type and length', async () => {
    const meta = new Map((await backend().meta()).map((m) => [m.key, m]))
    expect(meta.get('sv_length')).toMatchObject({ dataType: 'numeric', min: 300, max: 7000 })
    expect(meta.get('end_pos')).toMatchObject({ dataType: 'numeric', min: 5000, max: 9000 })
    expect(meta.get('sv_type')).toMatchObject({ dataType: 'text', distinctCount: 3 })
    expect([...(meta.get('sv_type')?.distinctValues ?? [])].sort()).toEqual(['DEL', 'DUP', 'INS'])
  })

  it("each ready carrier shows one call's metrics, the call with the highest end", async () => {
    const carriers = await backend().carriers(identity('chr1', 1000, '<DEL>', 'sv'))
    const common = { gt_num: '0/1', gq: 30, dp: 40, filter: 'PASS', copy_number: null }
    expect(withoutIds(carriers)).toEqual([
      {
        ...common,
        case_name: 'sv-a',
        qual: 50,
        caller: 'manta',
        end_pos: 5000,
        sv_length: 4000,
        sv_support: 12,
        sv_vaf: 0.4
      },
      {
        ...common,
        case_name: 'sv-b',
        qual: 20,
        caller: 'manta',
        end_pos: 4500,
        sv_length: 3500,
        sv_support: 5,
        sv_vaf: 0.2
      }
    ])
  })

  it('reports a call without END and a CNV call', async () => {
    const [insertion] = await backend().carriers(identity('chr4', 400, '<INS>', 'sv'))
    expect(insertion).toMatchObject({ end_pos: null, sv_length: 300, sv_support: null })
    const [cnv] = await backend().carriers(identity('chr2', 2000, '<DUP>', 'cnv'))
    expect(cnv).toMatchObject({ copy_number: 3, sv_support: null, end_pos: 9000 })
  })

  it('case view: filters, sorts and bounds SV length by the unsigned length shown', async () => {
    // sv-a: DEL -2000, DEL -4000, INS 300. Signed, "> 1000" would drop both deletions.
    const longer = { sv_length: { operator: '>' as const, value: 1000 } }
    expect((await backend().caseLengths(longer)).sort()).toEqual([-2000, -4000].sort())
    expect(
      (await backend().caseLengths(undefined, [{ key: 'sv_length', order: 'asc' }])).map(Math.abs)
    ).toEqual([300, 2000, 4000])
    expect(await backend().caseMeta('sv_length')).toMatchObject({
      dataType: 'numeric',
      min: 300,
      max: 7000 // the whole case: its CNV DUP too
    })
  })
}

describe('cohort SV/CNV call context — SQLite', () => {
  let service: DatabaseService
  let svCase = 0

  beforeAll(() => {
    service = new DatabaseService(':memory:')
    const db = service.database
    const placeholders = INSERT_VARIANT_COLUMNS.split(',')
      .map(() => '?')
      .join(', ')
    for (const fixture of CASES) {
      const caseId = Number(
        db
          .prepare(
            "INSERT INTO cases (name, file_path, file_size, variant_count, created_at, genome_build, import_status) VALUES (?, '/t', 0, ?, 0, 'GRCh38', ?)"
          )
          .run(fixture.name, fixture.calls.length, fixture.ready ? 'ready' : 'importing')
          .lastInsertRowid
      )
      if (fixture.name === 'sv-a') svCase = caseId
      for (const call of fixture.calls) {
        const id = db
          .prepare(`INSERT INTO variants (${INSERT_VARIANT_COLUMNS}) VALUES (${placeholders})`)
          .run(...variantValues(caseId, call)).lastInsertRowid
        if (call.sv) {
          db.prepare('INSERT INTO variant_sv (variant_id, support, vaf) VALUES (?, ?, ?)').run(
            id,
            call.sv.support,
            call.sv.vaf
          )
        }
        if (call.cnv) {
          db.prepare('INSERT INTO variant_cnv (variant_id, copy_number) VALUES (?, ?)').run(
            id,
            call.cnv.copy_number
          )
        }
      }
    }
    service.cohortSummary.rebuild()
  })

  afterAll(() => service.close())

  cohortCallAssertions(() => ({
    rows: async (params) =>
      service.cohort.getCohortVariants({ limit: 50, offset: 0, ...params }).data,
    carriers: async (variant) => service.cohort.getCarriers(variant),
    meta: async () => service.cohort.getColumnMeta(),
    caseLengths: async (columnFilters, sortBy) =>
      service.variants
        .getVariants(
          { case_id: svCase, variant_type: 'sv', column_filters: columnFilters },
          50,
          0,
          sortBy
        )
        .data.map((v) => Number(v.sv_length)),
    caseMeta: async (column) => service.variants.getColumnMeta({ caseId: svCase }, column)
  }))
})

describe.skipIf(!RUN_PG)('cohort SV/CNV call context — PostgreSQL parity', () => {
  let schema: string
  let pool: Pool
  let repo: PostgresCohortRepository
  let svCase = 0

  beforeAll(async () => {
    schema = `vt_svcalls_${randomBytes(4).toString('hex')}`
    pool = new Pool({ connectionString: PG_URL, max: 2 })
    await pool.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`)
    await new PostgresMigrationRunner(pool, schema, POSTGRES_MIGRATIONS).migrate()
    const summary = new PostgresCohortSummaryRepository()
    const placeholders = INSERT_VARIANT_COLUMNS.split(',')
      .map((_, i) => `$${i + 1}`)
      .join(', ')
    for (const fixture of CASES) {
      const caseId = (
        await pool.query<{ id: number }>(
          `INSERT INTO "${schema}".cases_all (name, file_path, file_size, created_at, genome_build, import_status)
             VALUES ($1, '/t', 0, 0, 'GRCh38', $2) RETURNING id`,
          [fixture.name, fixture.ready ? 'ready' : 'importing']
        )
      ).rows[0].id
      if (fixture.name === 'sv-a') svCase = Number(caseId)
      for (const call of fixture.calls) {
        const id = (
          await pool.query<{ id: number }>(
            `INSERT INTO "${schema}".variants_all (${INSERT_VARIANT_COLUMNS}) VALUES (${placeholders}) RETURNING id`,
            variantValues(caseId, call)
          )
        ).rows[0].id
        if (call.sv) {
          await pool.query(
            `INSERT INTO "${schema}".variant_sv (variant_id, support, vaf) VALUES ($1, $2, $3)`,
            [id, call.sv.support, call.sv.vaf]
          )
        }
        if (call.cnv) {
          await pool.query(
            `INSERT INTO "${schema}".variant_cnv (variant_id, copy_number) VALUES ($1, $2)`,
            [id, call.cnv.copy_number]
          )
        }
      }
      if (!fixture.ready) continue
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        await summary.incrementalAdd({ schema, client: client as never, caseId })
        await summary.refreshColumnMetas({ schema, client: client as never, caseId })
        await client.query('COMMIT')
      } finally {
        client.release()
      }
    }
    repo = new PostgresCohortRepository(pool, schema)
  }, 120_000)

  afterAll(async () => {
    if (pool === undefined) return
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    await pool.end()
  }, 120_000)

  cohortCallAssertions(() => ({
    rows: async (params) => (await repo.queryVariants({ limit: 50, offset: 0, ...params })).data,
    carriers: (variant) => repo.getCarriers(variant),
    meta: () => repo.getColumnMeta(),
    caseLengths: async (columnFilters, sortBy) =>
      (
        await new PostgresVariantReadRepository(pool, schema).queryVariants(
          { case_id: svCase, variant_type: 'sv', column_filters: columnFilters },
          50,
          0,
          sortBy
        )
      ).data.map((v) => Number(v.sv_length)),
    caseMeta: (column) =>
      new PostgresVariantReadRepository(pool, schema).getColumnMeta({ caseId: svCase }, column)
  }))
})
