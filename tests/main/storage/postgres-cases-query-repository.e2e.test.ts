import { randomBytes } from 'node:crypto'

import { Client, Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { PostgresCasesQueryRepository } from '../../../src/main/storage/postgres/PostgresCasesQueryRepository'
import { POSTGRES_MIGRATIONS } from '../../../src/main/storage/postgres/migrations/definitions'
import { PostgresMigrationRunner } from '../../../src/main/storage/postgres/migrations/PostgresMigrationRunner'

const RUN = process.env.VARLENS_RUN_POSTGRES_E2E === '1'
const PG_URL =
  process.env.VARLENS_PG_URL ??
  'postgres://varlens:varlens_dev_password@127.0.0.1:55432/varlens_dev'

describe.skipIf(!RUN)('PostgresCasesQueryRepository — migrated cases view', () => {
  const schema = `varlens_test_cases_query_${Date.now()}_${randomBytes(4).toString('hex')}`
  let pool: Pool
  let probe: Client

  beforeAll(async () => {
    pool = new Pool({ connectionString: PG_URL, max: 2 })
    probe = new Client({ connectionString: PG_URL })
    await probe.connect()
    await new PostgresMigrationRunner(pool, schema, POSTGRES_MIGRATIONS).migrate()
  }, 60_000)

  afterAll(async () => {
    if (probe) await probe.end()
    if (pool) await pool.end()

    const cleaner = new Client({ connectionString: PG_URL })
    await cleaner.connect()
    await cleaner.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    await cleaner.end()
  }, 60_000)

  it('queries a ready case with metadata and cohorts through the view', async () => {
    const now = Date.now()
    const caseResult = await probe.query<{ id: number }>(
      `INSERT INTO "${schema}"."cases"
        (name, file_path, file_size, variant_count, created_at, genome_build)
       VALUES ('view-backed-case', '/tmp/view-backed-case.json', 42, 1, $1, 'GRCh38')
       RETURNING id`,
      [now]
    )
    const caseId = Number(caseResult.rows[0].id)
    await probe.query(
      `INSERT INTO "${schema}"."case_metadata" (case_id, affected_status, sex)
       VALUES ($1, 'affected', 'female')`,
      [caseId]
    )
    const cohortResult = await probe.query<{ id: number }>(
      `INSERT INTO "${schema}"."cohort_groups" (name, created_at)
       VALUES ('view-backed-cohort', $1)
       RETURNING id`,
      [now]
    )
    await probe.query(
      `INSERT INTO "${schema}"."case_cohort_links" (case_id, cohort_id)
       VALUES ($1, $2)`,
      [caseId, cohortResult.rows[0].id]
    )

    const result = await new PostgresCasesQueryRepository(pool, schema).queryCases({
      limit: 25,
      offset: 0
    })

    expect(result).toEqual({
      data: [
        expect.objectContaining({
          id: caseId,
          name: 'view-backed-case',
          affected_status: 'affected',
          sex: 'female',
          cohort_names: ['view-backed-cohort']
        })
      ],
      total_count: 1
    })
  }, 60_000)
})
