/**
 * #490 — work that legitimately runs longer than the pool's 30 s timeouts
 * (background summary rebuild, hiding a large case, export streams) against a
 * real Postgres, with the timeouts lowered to 500 ms and a 1.5 s statement.
 *
 * Gated by VARLENS_RUN_POSTGRES_E2E=1. Requires `make pg-up`.
 */
import { randomBytes } from 'node:crypto'

import { Client, Pool } from 'pg'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { POSTGRES_MIGRATIONS } from '../../../src/main/storage/postgres/migrations/definitions'
import { PostgresMigrationRunner } from '../../../src/main/storage/postgres/migrations/PostgresMigrationRunner'
import { PostgresCaseLifecycleRepository } from '../../../src/main/storage/postgres/PostgresCaseLifecycleRepository'
import {
  awaitBackgroundRebuild,
  prepareCohortRead
} from '../../../src/main/storage/postgres/cohort-read-freshness'

const RUN = process.env.VARLENS_RUN_POSTGRES_E2E === '1'
const PG_URL =
  process.env.VARLENS_PG_URL ??
  'postgres://varlens:varlens_dev_password@127.0.0.1:55432/varlens_dev'

const SHORT_TIMEOUT_MS = 500
const SLOW_STATEMENT_S = 1.5

describe.skipIf(!RUN)('long-running work outlives the pool timeouts (#490)', () => {
  let schema: string
  let pool: Pool
  let probe: Client

  beforeEach(async () => {
    schema = `varlens_test_long_running_${Date.now()}_${randomBytes(4).toString('hex')}`
    probe = new Client({ connectionString: PG_URL })
    await probe.connect()
    await probe.query(`CREATE SCHEMA "${schema}"`)
    const migrationPool = new Pool({ connectionString: PG_URL, max: 1 })
    await new PostgresMigrationRunner(migrationPool, schema, POSTGRES_MIGRATIONS).migrate()
    await migrationPool.end()
    // What the app pool looks like, with both 30 s timeouts lowered.
    pool = new Pool({
      connectionString: PG_URL,
      max: 2,
      query_timeout: SHORT_TIMEOUT_MS,
      statement_timeout: SHORT_TIMEOUT_MS
    })
  }, 60_000)

  afterEach(async () => {
    await pool.end()
    await probe.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    await probe.end()
  }, 60_000)

  async function seedCaseWithVariant(name: string): Promise<number> {
    const res = await probe.query<{ id: number }>(
      `INSERT INTO "${schema}".cases (name, file_path, file_size, created_at, genome_build)
         VALUES ($1, $2, 0, $3, 'GRCh38') RETURNING id`,
      [name, `/tmp/${name}.json`, Date.now()]
    )
    await probe.query(
      `INSERT INTO "${schema}".variants
         (case_id, chr, pos, ref, alt, variant_type, gene_symbol, gt_num)
         VALUES ($1, '1', 100, 'A', 'T', 'snv', 'GENE1', '0/1')`,
      [res.rows[0].id]
    )
    return res.rows[0].id
  }

  /** Every UPDATE of `table` takes SLOW_STATEMENT_S, like a large cohort would. */
  async function slowDownUpdatesOf(table: string): Promise<void> {
    await probe.query(
      `CREATE FUNCTION "${schema}".slow_update() RETURNS trigger LANGUAGE plpgsql AS
         $$ BEGIN PERFORM pg_sleep(${SLOW_STATEMENT_S}); RETURN NEW; END $$`
    )
    await probe.query(
      `CREATE TRIGGER slow_update BEFORE UPDATE ON "${schema}"."${table}"
         FOR EACH ROW EXECUTE FUNCTION "${schema}".slow_update()`
    )
  }

  it('a background summary rebuild completes', async () => {
    await seedCaseWithVariant('rebuild-a')
    await prepareCohortRead({ pool, schema })
    await probe.query(
      `UPDATE "${schema}".cohort_summary_state
          SET is_stale = true, stale_reason = 'test', stale_at = now()
        WHERE id = 1`
    )
    await slowDownUpdatesOf('cohort_summary_state')
    const previous = process.env.VARLENS_PG_COHORT_SUMMARY_SYNC_MAX_CASES
    process.env.VARLENS_PG_COHORT_SUMMARY_SYNC_MAX_CASES = '0'
    try {
      expect((await prepareCohortRead({ pool, schema })).warnings).toEqual({ staleSummary: true })
      await awaitBackgroundRebuild(schema)
    } finally {
      if (previous === undefined) delete process.env.VARLENS_PG_COHORT_SUMMARY_SYNC_MAX_CASES
      else process.env.VARLENS_PG_COHORT_SUMMARY_SYNC_MAX_CASES = previous
    }

    const state = await probe.query<{ is_stale: boolean }>(
      `SELECT is_stale FROM "${schema}".cohort_summary_state WHERE id = 1`
    )
    expect(state.rows[0].is_stale).toBe(false)
  }, 60_000)

  it('hiding a case for deletion completes', async () => {
    const caseId = await seedCaseWithVariant('hide-a')
    await slowDownUpdatesOf('cases_all')

    const hidden = await new PostgresCaseLifecycleRepository(pool, schema).hideCase(caseId)

    expect(hidden.state).toBe('hidden')
  }, 60_000)

  it('an export stream with a slow consumer completes and leaves the connection as it was', async () => {
    const { streamLongQuery } =
      await import('../../../src/main/storage/postgres/long-running-client')
    const single = new Pool({
      connectionString: PG_URL,
      max: 1,
      query_timeout: SHORT_TIMEOUT_MS,
      statement_timeout: SHORT_TIMEOUT_MS
    })
    try {
      const rows: unknown[] = []
      for await (const row of streamLongQuery(
        single,
        'SELECT g FROM generate_series(1, $1) g',
        [5]
      )) {
        rows.push(row)
        await new Promise((resolve) => setTimeout(resolve, (SLOW_STATEMENT_S * 1000) / 5))
      }
      expect(rows).toHaveLength(5)

      // max: 1, so this is the connection the stream used.
      const after = await single.query<{ statement_timeout: string }>('SHOW statement_timeout')
      expect(after.rows[0].statement_timeout).toBe(`${SHORT_TIMEOUT_MS}ms`)
      await expect(single.query(`SELECT pg_sleep(${SLOW_STATEMENT_S})`)).rejects.toThrow(
        /Query read timeout|statement timeout/
      )
    } finally {
      await single.end()
    }
  }, 60_000)
})
