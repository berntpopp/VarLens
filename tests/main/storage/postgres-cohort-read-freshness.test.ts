/**
 * Sprint A PR-3 C5 — cohort-read freshness / staleness orchestration against a
 * real Postgres.
 *
 * Covers the read-path behaviour wired in PR3-17:
 *
 *   - readCohortSummaryStatus reads the cohort_summary_state singleton in the
 *     existing IPC shape { is_stale, last_rebuilt_at:number } (Pass-9 #6).
 *   - prepareCohortRead force-rebuilds on the bootstrap-on-existing-data case
 *     (last_rebuilt_at IS NULL, or variants present but summary empty) regardless
 *     of the 50-case sync threshold (Pass-9 #5), and clears staleness.
 *   - prepareCohortRead surfaces warnings.staleSummary=true only while it serves
 *     a stale summary it could not synchronously refresh (Pass-8 #6).
 *
 * Gated by VARLENS_RUN_POSTGRES_E2E=1. Requires `make pg-up`.
 */
import { randomBytes } from 'node:crypto'

import { Client, Pool } from 'pg'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { PostgresCohortSummaryRepository } from '../../../src/main/storage/postgres/PostgresCohortSummaryRepository'
import { lockSummaryForWrite } from '../../../src/main/storage/postgres/cohort-summary-lock'
import { POSTGRES_MIGRATIONS } from '../../../src/main/storage/postgres/migrations/definitions'
import { PostgresMigrationRunner } from '../../../src/main/storage/postgres/migrations/PostgresMigrationRunner'
import {
  awaitBackgroundRebuild,
  prepareCohortRead,
  readCohortSummaryStatus
} from '../../../src/main/storage/postgres/cohort-read-freshness'

const RUN = process.env.VARLENS_RUN_POSTGRES_E2E === '1'
const PG_URL =
  process.env.VARLENS_PG_URL ??
  'postgres://varlens:varlens_dev_password@127.0.0.1:55432/varlens_dev'

describe.skipIf(!RUN)('cohort-read freshness — Sprint A C5 (PR3-17)', () => {
  let schema: string
  let pool: Pool
  let probe: Client
  const now = Date.now()

  beforeEach(async () => {
    schema = `varlens_test_cohort_fresh_${Date.now()}_${randomBytes(4).toString('hex')}`
    const provisioner = new Client({ connectionString: PG_URL })
    await provisioner.connect()
    await provisioner.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`)
    await provisioner.end()

    pool = new Pool({ connectionString: PG_URL, max: 2 })
    probe = new Client({ connectionString: PG_URL })
    await probe.connect()

    await new PostgresMigrationRunner(pool, schema, POSTGRES_MIGRATIONS).migrate()
  }, 60_000)

  afterEach(async () => {
    if (probe) await probe.end()
    if (pool) await pool.end()
    const cleaner = new Client({ connectionString: PG_URL })
    await cleaner.connect()
    await cleaner.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    await cleaner.end()
  }, 60_000)

  async function seedCase(name: string, genomeBuild = 'GRCh38'): Promise<number> {
    const res = await probe.query<{ id: number }>(
      `INSERT INTO "${schema}".cases (name, file_path, file_size, created_at, genome_build)
         VALUES ($1, $2, 0, $3, $4) RETURNING id`,
      [name, `/tmp/${name}.json`, now, genomeBuild]
    )
    return res.rows[0].id
  }

  async function seedVariant(caseId: number, chr: string, pos: number): Promise<void> {
    await probe.query(
      `INSERT INTO "${schema}".variants
         (case_id, chr, pos, ref, alt, variant_type, gene_symbol, gt_num)
         VALUES ($1, $2, $3, 'A', 'T', 'snv', 'GENE1', '0/1')`,
      [caseId, chr, pos]
    )
  }

  async function summaryRowCount(): Promise<number> {
    const res = await probe.query<{ n: string }>(
      `SELECT COUNT(*)::bigint AS n FROM "${schema}".cohort_variant_summary`
    )
    return Number(res.rows[0].n)
  }

  async function isStale(): Promise<boolean> {
    const res = await probe.query<{ is_stale: boolean }>(
      `SELECT is_stale FROM "${schema}".cohort_summary_state WHERE id = 1`
    )
    return res.rows[0].is_stale
  }

  it('readCohortSummaryStatus returns the existing IPC shape', async () => {
    const status = await readCohortSummaryStatus({ pool, schema })
    expect(status).toEqual({ is_stale: false, last_rebuilt_at: 0 })
    expect(typeof status.last_rebuilt_at).toBe('number')
  }, 60_000)

  it('bootstrap: never_rebuilt + variants present forces a synchronous rebuild', async () => {
    const caseA = await seedCase('boot-a')
    await seedVariant(caseA, '1', 100)
    expect(await summaryRowCount()).toBe(0)

    const result = await prepareCohortRead({ pool, schema })

    // Summary materialised and staleness cleared by the forced rebuild.
    expect(await summaryRowCount()).toBe(1)
    expect(await isStale()).toBe(false)
    // A successful synchronous rebuild serves fresh data → no warning.
    expect(result.warnings).toBeUndefined()
  }, 60_000)

  it('variants present but summary empty forces a synchronous rebuild', async () => {
    const caseA = await seedCase('boot-empty-a')
    await seedVariant(caseA, '2', 200)
    // Record a rebuild time so never_rebuilt is false, but leave summary empty.
    await probe.query(
      `UPDATE "${schema}".cohort_summary_state
         SET last_rebuilt_at = now(), is_stale = false WHERE id = 1`
    )
    expect(await summaryRowCount()).toBe(0)

    await prepareCohortRead({ pool, schema })

    expect(await summaryRowCount()).toBe(1)
  }, 60_000)

  it('fresh empty schema does NOT rebuild and reports no warning', async () => {
    const result = await prepareCohortRead({ pool, schema })
    expect(await summaryRowCount()).toBe(0)
    expect(result.warnings).toBeUndefined()
  }, 60_000)

  it('stale below the sync threshold rebuilds synchronously (no warning)', async () => {
    const caseA = await seedCase('stale-sync-a')
    await seedVariant(caseA, '3', 300)
    // Establish a rebuilt baseline so the bootstrap override does not fire.
    await prepareCohortRead({ pool, schema })
    expect(await summaryRowCount()).toBe(1)

    // Add a second variant and flag the summary stale.
    await seedVariant(caseA, '3', 301)
    await probe.query(
      `UPDATE "${schema}".cohort_summary_state
         SET is_stale = true, stale_reason = 'test', stale_at = now() WHERE id = 1`
    )

    const result = await prepareCohortRead({ pool, schema })
    expect(await isStale()).toBe(false)
    expect(await summaryRowCount()).toBe(2)
    expect(result.warnings).toBeUndefined()
  }, 60_000)

  it('stale above the sync threshold serves stale + warns + schedules bg rebuild', async () => {
    const caseA = await seedCase('stale-bg-a')
    await seedVariant(caseA, '4', 400)
    await prepareCohortRead({ pool, schema })

    // Flag stale and force the sync threshold to 0 so this read serves stale.
    await probe.query(
      `UPDATE "${schema}".cohort_summary_state
         SET is_stale = true, stale_reason = 'test', stale_at = now() WHERE id = 1`
    )
    const previous = process.env.VARLENS_PG_COHORT_SUMMARY_SYNC_MAX_CASES
    process.env.VARLENS_PG_COHORT_SUMMARY_SYNC_MAX_CASES = '0'
    try {
      const result = await prepareCohortRead({ pool, schema })
      expect(result.warnings).toEqual({ staleSummary: true })
    } finally {
      if (previous === undefined) {
        delete process.env.VARLENS_PG_COHORT_SUMMARY_SYNC_MAX_CASES
      } else {
        process.env.VARLENS_PG_COHORT_SUMMARY_SYNC_MAX_CASES = previous
      }
    }
  }, 60_000)

  async function lastRebuiltAt(): Promise<Date | null> {
    const res = await probe.query<{ last_rebuilt_at: Date | null }>(
      `SELECT last_rebuilt_at FROM "${schema}".cohort_summary_state WHERE id = 1`
    )
    return res.rows[0].last_rebuilt_at
  }

  it('serves a summary maintained by imports without ever rebuilding it', async () => {
    // What an import does: publish the case and add it to the summary
    // incrementally. On a database that never had a full rebuild this used to
    // force a TRUNCATE + rebuild on the first cohort read.
    const caseA = await seedCase('incremental-a')
    await seedVariant(caseA, '5', 500)
    const client = await pool.connect()
    try {
      await new PostgresCohortSummaryRepository().incrementalAdd({
        schema,
        client: client as never,
        caseId: caseA
      })
    } finally {
      client.release()
    }
    expect(await summaryRowCount()).toBe(1)

    const result = await prepareCohortRead({ pool, schema })

    expect(result.warnings).toBeUndefined()
    expect(await lastRebuiltAt()).toBeNull()
    expect(await summaryRowCount()).toBe(1)
  }, 60_000)

  it('rebuilds a never-rebuilt summary that a migration flagged stale', async () => {
    const caseA = await seedCase('seeded-stale-a')
    await seedVariant(caseA, '6', 600)
    await seedVariant(caseA, '6', 601)
    // A partial summary plus the stale flag the 0010 seed sets on existing data.
    const client = await pool.connect()
    try {
      await new PostgresCohortSummaryRepository().incrementalAdd({
        schema,
        client: client as never,
        caseId: caseA
      })
    } finally {
      client.release()
    }
    await probe.query(`DELETE FROM "${schema}".cohort_variant_summary WHERE pos = 601`)
    await probe.query(
      `UPDATE "${schema}".cohort_summary_state
         SET is_stale = true, stale_reason = 'migration_initial_existing_data', stale_at = now()
       WHERE id = 1`
    )

    const result = await prepareCohortRead({ pool, schema })

    expect(result.warnings).toBeUndefined()
    expect(await summaryRowCount()).toBe(2)
    expect(await isStale()).toBe(false)
    expect(await lastRebuiltAt()).not.toBeNull()
  }, 60_000)

  it('does not wait for a publishing import: serves current rows and rebuilds afterwards', async () => {
    const caseA = await seedCase('busy-a')
    await seedVariant(caseA, '7', 700)
    await prepareCohortRead({ pool, schema })
    await seedVariant(caseA, '7', 701)
    await probe.query(
      `UPDATE "${schema}".cohort_summary_state
         SET is_stale = true, stale_reason = 'test', stale_at = now() WHERE id = 1`
    )

    // An import in its publication step holds the summary write lock.
    const publisher = new Client({ connectionString: PG_URL })
    await publisher.connect()
    try {
      await publisher.query('BEGIN')
      await lockSummaryForWrite(publisher, schema)

      const started = Date.now()
      const result = await prepareCohortRead({ pool, schema })
      const waitedMs = Date.now() - started

      expect(result.warnings).toEqual({ staleSummary: true })
      expect(waitedMs).toBeLessThan(2000)
      // Readers still see the previous rows while the rebuild waits its turn.
      expect(await summaryRowCount()).toBe(1)
    } finally {
      await publisher.query('COMMIT')
      await publisher.end()
    }

    await awaitBackgroundRebuild(schema)
    expect(await isStale()).toBe(false)
    expect(await summaryRowCount()).toBe(2)
  }, 60_000)

  it('keeps the previous rows visible to other sessions while a rebuild runs', async () => {
    const caseA = await seedCase('visible-a')
    await seedVariant(caseA, '8', 800)
    await prepareCohortRead({ pool, schema })

    const rebuilder = await pool.connect()
    try {
      await rebuilder.query('BEGIN')
      await new PostgresCohortSummaryRepository().rebuild({ schema, client: rebuilder as never })
      // Uncommitted rebuild in progress: a reader must neither block nor see an empty table.
      await probe.query("SET lock_timeout = '1s'")
      expect(await summaryRowCount()).toBe(1)
      await rebuilder.query('COMMIT')
    } finally {
      rebuilder.release()
    }
  }, 60_000)
})
