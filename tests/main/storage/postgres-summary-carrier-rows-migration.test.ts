/**
 * Migration 0029 (#555, mirrors SQLite v46) against a real PostgreSQL: a
 * summary counted before the no-call rule is flagged stale, so deleting the
 * only carrier afterwards ends with the row gone, not a phantom carrier.
 *
 * Gated by VARLENS_RUN_POSTGRES_E2E=1. Requires `make pg-up`.
 */
import { randomBytes } from 'node:crypto'

import { Client, Pool } from 'pg'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { POSTGRES_MIGRATIONS } from '../../../src/main/storage/postgres/migrations/definitions'
import { PostgresMigrationRunner } from '../../../src/main/storage/postgres/migrations/PostgresMigrationRunner'
import { PostgresCaseLifecycleRepository } from '../../../src/main/storage/postgres/PostgresCaseLifecycleRepository'
import { PostgresCohortRepository } from '../../../src/main/storage/postgres/PostgresCohortRepository'
import { PostgresCohortSummaryRepository } from '../../../src/main/storage/postgres/PostgresCohortSummaryRepository'

const RUN = process.env.VARLENS_RUN_POSTGRES_E2E === '1'
const PG_URL =
  process.env.VARLENS_PG_URL ??
  'postgres://varlens:varlens_dev_password@127.0.0.1:55432/varlens_dev'

const BEFORE_0029 = POSTGRES_MIGRATIONS.filter((migration) => migration.version < '0029')

describe.skipIf(!RUN)('migration 0029: summaries counted with no-calls are rebuilt', () => {
  let schema: string
  let pool: Pool
  const summary = new PostgresCohortSummaryRepository()

  async function seedCase(name: string, gt: string): Promise<number> {
    const row = await pool.query<{ id: string }>(
      `INSERT INTO "${schema}".cases (name, file_path, file_size, created_at, genome_build)
       VALUES ($1, $2, 0, $3, 'GRCh38') RETURNING id`,
      [name, `/tmp/${name}.vcf`, Date.now()]
    )
    const id = Number(row.rows[0].id)
    await pool.query(
      `INSERT INTO "${schema}".variants (case_id, chr, pos, ref, alt, variant_type, end_pos, gt_num)
       VALUES ($1, '1', 5000, 'N', '<DEL>', 'sv', 9000, $2)`,
      [id, gt]
    )
    return id
  }

  async function rebuild(): Promise<void> {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await summary.rebuild({ schema, client: client as never })
      await client.query('COMMIT')
    } finally {
      client.release()
    }
  }

  const rows = async (): Promise<unknown[]> =>
    (await pool.query(`SELECT carrier_count FROM "${schema}".cohort_variant_summary`)).rows

  beforeEach(async () => {
    schema = `varlens_test_0029_${Date.now()}_${randomBytes(4).toString('hex')}`
    const provisioner = new Client({ connectionString: PG_URL })
    await provisioner.connect()
    await provisioner.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`)
    await provisioner.end()
    pool = new Pool({ connectionString: PG_URL, max: 3 })
    await new PostgresMigrationRunner(pool, schema, BEFORE_0029).migrate()
  }, 120_000)

  afterEach(async () => {
    if (pool) await pool.end()
    const cleaner = new Client({ connectionString: PG_URL })
    await cleaner.connect()
    await cleaner.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    await cleaner.end()
  }, 60_000)

  it('flags the summary stale; deleting the only carrier then removes the row', async () => {
    await seedCase('no-call', './.')
    const carrier = await seedCase('carrier', '0/1')
    await rebuild()
    // The summary as the previous version wrote it: the no-call counted too.
    await pool.query(`UPDATE "${schema}".cohort_variant_summary SET carrier_count = 2`)

    const result = await new PostgresMigrationRunner(
      pool,
      schema,
      POSTGRES_MIGRATIONS.filter((migration) => migration.version <= '0029')
    ).migrate()
    expect(result.applied).toEqual(['0029'])
    const state = await pool.query(
      `SELECT is_stale, stale_reason FROM "${schema}".cohort_summary_state WHERE id = 1`
    )
    expect(state.rows[0]).toEqual({ is_stale: true, stale_reason: 'migration_0029_carrier_rows' })

    // A stale summary is left to its rebuild. Asking for the status (as the
    // case view's freshness watcher does) starts it, without a cohort read.
    await new PostgresCaseLifecycleRepository(pool, schema).deleteCase(carrier)
    const cohort = new PostgresCohortRepository(pool, schema)
    const deadline = Date.now() + 30_000
    while ((await cohort.getSummaryStatus()).is_stale && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
    expect((await cohort.getSummaryStatus()).is_stale).toBe(false)
    expect(await rows()).toEqual([])
  }, 120_000)
})
