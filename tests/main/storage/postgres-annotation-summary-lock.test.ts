/**
 * #503 — annotation writes and the cohort summary write lock, against a real
 * Postgres. A star saved while a rebuild replaced the summary rows used to be
 * missing from `has_star` until the next rebuild.
 *
 * Gated by VARLENS_RUN_POSTGRES_E2E=1. Requires `make pg-up`.
 */
import { randomBytes } from 'node:crypto'

import { Client, Pool } from 'pg'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { InvalidParametersError } from '../../../src/main/ipc/errors'
import { PostgresAnnotationsRepository } from '../../../src/main/storage/postgres/PostgresAnnotationsRepository'
import { PostgresCohortSummaryRepository } from '../../../src/main/storage/postgres/PostgresCohortSummaryRepository'
import {
  prepareCohortRead,
  readCohortSummaryStatus
} from '../../../src/main/storage/postgres/cohort-read-freshness'
import { lockSummaryForWrite } from '../../../src/main/storage/postgres/cohort-summary-lock'
import { summaryAwaitsRebuild } from '../../../src/main/storage/postgres/cohort-summary-state-sql'
import { POSTGRES_MIGRATIONS } from '../../../src/main/storage/postgres/migrations/definitions'
import { PostgresMigrationRunner } from '../../../src/main/storage/postgres/migrations/PostgresMigrationRunner'

const RUN = process.env.VARLENS_RUN_POSTGRES_E2E === '1'
const PG_URL =
  process.env.VARLENS_PG_URL ??
  'postgres://varlens:varlens_dev_password@127.0.0.1:55432/varlens_dev'

describe.skipIf(!RUN)('annotation writes take the summary write lock (#503)', () => {
  let schema: string
  let pool: Pool
  let holder: Client
  let caseId: number
  let variantId: number

  beforeEach(async () => {
    schema = `varlens_test_annotation_lock_${Date.now()}_${randomBytes(4).toString('hex')}`
    pool = new Pool({ connectionString: PG_URL, max: 3 })
    await pool.query(`CREATE SCHEMA "${schema}"`)
    await new PostgresMigrationRunner(pool, schema, POSTGRES_MIGRATIONS).migrate()
    const created = await pool.query<{ id: number }>(
      `INSERT INTO "${schema}".cases (name, file_path, file_size, created_at, genome_build)
         VALUES ('lock-a', '/tmp/lock-a.json', 0, 0, 'GRCh38') RETURNING id`
    )
    caseId = created.rows[0].id
    const variant = await pool.query<{ id: number }>(
      `INSERT INTO "${schema}".variants
         (case_id, chr, pos, ref, alt, variant_type, gene_symbol, gt_num)
         VALUES ($1, '1', 100, 'A', 'T', 'snv', 'GENE1', '0/1') RETURNING id`,
      [caseId]
    )
    variantId = Number(variant.rows[0].id)
    await prepareCohortRead({ pool, schema })

    // Another writer of the derived tables: holds the lock until it commits.
    holder = new Client({ connectionString: PG_URL })
    await holder.connect()
    await holder.query('BEGIN')
    await lockSummaryForWrite(holder, schema)
  }, 60_000)

  afterEach(async () => {
    await holder.end()
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    await pool.end()
  }, 60_000)

  async function hasStar(): Promise<boolean> {
    const result = await pool.query<{ has_star: boolean }>(
      `SELECT has_star FROM "${schema}".cohort_variant_summary`
    )
    return result.rows[0].has_star
  }

  it('a star saved while a rebuild is in flight shows once the rebuild committed', async () => {
    await new PostgresCohortSummaryRepository().rebuild({ schema, client: holder as never })
    const save = new PostgresAnnotationsRepository(pool, schema, 5_000).upsertGlobalAnnotation(
      '1',
      100,
      'A',
      'T',
      { starred: 1 }
    )
    await new Promise((resolve) => setTimeout(resolve, 300))
    await holder.query('COMMIT')
    await save

    expect(await hasStar()).toBe(true)
  }, 60_000)

  async function pendingRequests(): Promise<number> {
    const result = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM "${schema}".cohort_summary_rebuild_requests`
    )
    return result.rows[0].n
  }

  async function lastRebuiltAt(): Promise<number> {
    return (await readCohortSummaryStatus({ pool, schema })).last_rebuilt_at
  }

  it('a save under a busy lock leaves the counts valid; a read then refreshes only the flags', async () => {
    const repository = new PostgresAnnotationsRepository(pool, schema, 100)
    const rebuiltAt = await lastRebuiltAt()

    const saved = await repository.upsertPerCaseAnnotation(caseId, variantId, { starred: 1 })

    expect(saved.starred).toBe(1)
    expect(await pendingRequests()).toBe(1)
    // The counts are untouched by an annotation: incremental upkeep goes on.
    expect((await readCohortSummaryStatus({ pool, schema })).is_stale).toBe(false)
    expect(await summaryAwaitsRebuild({ schema, client: pool })).toBe(false)
    // The lock is still busy: the read says so and leaves the request alone.
    expect(await prepareCohortRead({ pool, schema })).toEqual({ warnings: { staleSummary: true } })
    expect(await pendingRequests()).toBe(1)

    await holder.query('COMMIT')
    expect(await prepareCohortRead({ pool, schema })).toEqual({})

    expect(await hasStar()).toBe(true)
    expect(await pendingRequests()).toBe(0)
    expect(await lastRebuiltAt()).toBe(rebuiltAt)
  }, 60_000)

  it('a save committed in the middle of a rebuild is in the flags when the rebuild commits', async () => {
    const repository = new PostgresAnnotationsRepository(pool, schema, 100)
    // Save after the rebuild wrote every summary row, before it finishes.
    const rebuilding = {
      query: async (text: string, values?: unknown[]) => {
        if (text.includes('last_rebuilt_at = now()')) {
          await repository.upsertGlobalAnnotation('1', 100, 'A', 'T', { starred: 1 })
        }
        return holder.query(text, values)
      }
    }

    await new PostgresCohortSummaryRepository().rebuild({ schema, client: rebuilding as never })
    await holder.query('COMMIT')

    expect(await hasStar()).toBe(true)
    expect(await pendingRequests()).toBe(0)
    expect((await readCohortSummaryStatus({ pool, schema })).is_stale).toBe(false)
  }, 60_000)

  it('a save after the rebuild served its requests is not lost and starts no second rebuild', async () => {
    const repository = new PostgresAnnotationsRepository(pool, schema, 100)
    await new PostgresCohortSummaryRepository().rebuild({ schema, client: holder as never })

    await repository.upsertGlobalAnnotation('1', 100, 'A', 'T', { starred: 1 })
    await holder.query('COMMIT')
    const rebuiltAt = await lastRebuiltAt()

    expect(await hasStar()).toBe(false)
    expect(await pendingRequests()).toBe(1)
    expect(await prepareCohortRead({ pool, schema })).toEqual({})
    expect(await hasStar()).toBe(true)
    expect(await pendingRequests()).toBe(0)
    expect(await lastRebuiltAt()).toBe(rebuiltAt)
  }, 60_000)

  it('still rejects a variant of another case while the lock is busy', async () => {
    const repository = new PostgresAnnotationsRepository(pool, schema, 100)

    const other = await pool.query<{ id: number }>(
      `INSERT INTO "${schema}".cases (name, file_path, file_size, created_at, genome_build)
         VALUES ('lock-b', '/tmp/lock-b.json', 0, 0, 'GRCh38') RETURNING id`
    )

    await expect(
      repository.upsertPerCaseAnnotation(other.rows[0].id, variantId, { starred: 1 })
    ).rejects.toBeInstanceOf(InvalidParametersError)
  }, 60_000)
})
