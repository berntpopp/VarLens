/**
 * Cohort SV/CNV call context (#573, #539) on both backends: cohort rows carry
 * End / type / length, and each carrier its own call metrics. SQLite always
 * runs; PostgreSQL (same fixture, same expectations) with
 * VARLENS_RUN_POSTGRES_E2E=1 (`make pg-up`).
 */
import { randomBytes } from 'node:crypto'

import Database from 'better-sqlite3-multiple-ciphers'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { CohortService } from '../../../src/main/database/cohort'
import { CohortSummaryService } from '../../../src/main/database/CohortSummaryService'
import { runMigrations } from '../../../src/main/database/migrations'
import { initializeSchema } from '../../../src/main/database/schema'
import { POSTGRES_MIGRATIONS } from '../../../src/main/storage/postgres/migrations/definitions'
import { PostgresMigrationRunner } from '../../../src/main/storage/postgres/migrations/PostgresMigrationRunner'
import { PostgresCohortRepository } from '../../../src/main/storage/postgres/PostgresCohortRepository'
import { PostgresCohortSummaryRepository } from '../../../src/main/storage/postgres/PostgresCohortSummaryRepository'
import type { CohortCarrier, CohortVariant } from '../../../src/shared/types/cohort'

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

const DEL: Omit<Call, 'end_pos' | 'sv_length' | 'qual' | 'sv'> = {
  chr: 'chr1',
  pos: 1000,
  alt: '<DEL>',
  variant_type: 'sv',
  sv_type: 'DEL',
  filter: 'PASS',
  caller: 'manta',
  gq: 30,
  dp: 40
}

const CASES: Array<{ name: string; calls: Call[] }> = [
  {
    name: 'sv-a',
    calls: [
      { ...DEL, end_pos: 5000, sv_length: -4000, qual: 50, sv: { support: 12, vaf: 0.4 } },
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
    calls: [{ ...DEL, end_pos: 4500, sv_length: -3500, qual: 20, sv: { support: 5, vaf: 0.2 } }]
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

const pick = (rows: CohortVariant[], pos: number) => {
  const row = rows.find((r) => r.pos === pos)
  return { end_pos: row?.end_pos, sv_type: row?.sv_type, sv_length: row?.sv_length }
}

// Case ids differ per backend; toEqual ignores the undefined key.
const carrierMetrics = (carriers: CohortCarrier[]) =>
  carriers.map((carrier) => ({ ...carrier, case_id: undefined }))

const EXPECTED_DEL_ROW = { end_pos: 5000, sv_type: 'DEL', sv_length: 4000 }
const EXPECTED_DEL_CARRIERS = [
  {
    case_name: 'sv-a',
    gt_num: '0/1',
    qual: 50,
    gq: 30,
    dp: 40,
    filter: 'PASS',
    caller: 'manta',
    end_pos: 5000,
    sv_length: 4000,
    sv_support: 12,
    sv_vaf: 0.4,
    copy_number: null
  },
  {
    case_name: 'sv-b',
    gt_num: '0/1',
    qual: 20,
    gq: 30,
    dp: 40,
    filter: 'PASS',
    caller: 'manta',
    end_pos: 4500,
    sv_length: 3500,
    sv_support: 5,
    sv_vaf: 0.2,
    copy_number: null
  }
]
const DEL_IDENTITY = {
  chr: 'chr1',
  pos: 1000,
  ref: 'N',
  alt: '<DEL>',
  variant_type: 'sv',
  genome_build: 'GRCh38'
}
const CNV_IDENTITY = { ...DEL_IDENTITY, chr: 'chr2', pos: 2000, alt: '<DUP>', variant_type: 'cnv' }

describe('cohort SV/CNV call context — SQLite', () => {
  let db: Database.Database
  let cohort: CohortService

  beforeAll(() => {
    db = new Database(':memory:')
    initializeSchema(db)
    runMigrations(db)
    const placeholders = INSERT_VARIANT_COLUMNS.split(',')
      .map(() => '?')
      .join(', ')
    for (const fixture of CASES) {
      const caseId = Number(
        db
          .prepare(
            "INSERT INTO cases (name, file_path, file_size, variant_count, created_at, genome_build) VALUES (?, '/t', 0, ?, 0, 'GRCh38')"
          )
          .run(fixture.name, fixture.calls.length).lastInsertRowid
      )
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
    new CohortSummaryService(db).rebuild()
    cohort = new CohortService(db)
  })

  afterAll(() => {
    cohort.close()
    db.close()
  })

  it('cohort rows carry End, SV type and unsigned length of the call at that End', () => {
    const sv = cohort.getCohortVariants({ variant_type: 'sv' }).data
    expect(pick(sv, 1000)).toEqual(EXPECTED_DEL_ROW)
    const cnv = cohort.getCohortVariants({ variant_type: 'cnv' }).data
    expect(pick(cnv, 2000)).toEqual({ end_pos: 9000, sv_type: 'DUP', sv_length: 7000 })
  })

  it('SNV rows have no call context', () => {
    const snv = cohort.getCohortVariants({ variant_type: 'snv' }).data
    expect(pick(snv, 300)).toEqual({ end_pos: null, sv_type: null, sv_length: null })
  })

  it('each carrier reports its own call metrics', () => {
    expect(carrierMetrics(cohort.getCarriers(DEL_IDENTITY))).toEqual(EXPECTED_DEL_CARRIERS)
    expect(cohort.getCarriers(CNV_IDENTITY)[0]).toMatchObject({ copy_number: 3, sv_support: null })
  })
})

describe.skipIf(!RUN_PG)('cohort SV/CNV call context — PostgreSQL parity', () => {
  let schema: string
  let pool: Pool
  let repo: PostgresCohortRepository

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
          `INSERT INTO "${schema}".cases (name, file_path, file_size, created_at, genome_build)
             VALUES ($1, '/t', 0, 0, 'GRCh38') RETURNING id`,
          [fixture.name]
        )
      ).rows[0].id
      for (const call of fixture.calls) {
        const id = (
          await pool.query<{ id: number }>(
            `INSERT INTO "${schema}".variants (${INSERT_VARIANT_COLUMNS}) VALUES (${placeholders}) RETURNING id`,
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
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        await summary.incrementalAdd({ schema, client: client as never, caseId })
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

  it('cohort rows carry the same End, SV type and length as SQLite', async () => {
    const sv = (await repo.queryVariants({ variant_type: 'sv', limit: 50, offset: 0 })).data
    expect(pick(sv, 1000)).toEqual(EXPECTED_DEL_ROW)
    const cnv = (await repo.queryVariants({ variant_type: 'cnv', limit: 50, offset: 0 })).data
    expect(pick(cnv, 2000)).toEqual({ end_pos: 9000, sv_type: 'DUP', sv_length: 7000 })
    const snv = (await repo.queryVariants({ variant_type: 'snv', limit: 50, offset: 0 })).data
    expect(pick(snv, 300)).toEqual({ end_pos: null, sv_type: null, sv_length: null })
  }, 60_000)

  it('carriers report the same call metrics as SQLite', async () => {
    expect(carrierMetrics(await repo.getCarriers(DEL_IDENTITY))).toEqual(EXPECTED_DEL_CARRIERS)
    expect((await repo.getCarriers(CNV_IDENTITY))[0]).toMatchObject({
      copy_number: 3,
      sv_support: null
    })
  }, 60_000)
})
