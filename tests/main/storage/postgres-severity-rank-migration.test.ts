/**
 * Migration 0025 (#469) against a real PostgreSQL: the severity rank columns
 * are added without rewriting the variants table, readers compute a missing
 * rank on the fly, rows imported before are backfilled in the background in
 * resumable batches, and the stale flag makes the summary rebuild.
 *
 * Gated by VARLENS_RUN_POSTGRES_E2E=1. Requires `make pg-up`.
 */
import { randomBytes } from 'node:crypto'

import { Client, Pool } from 'pg'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { clinvarRank, impactRank } from '../../../src/shared/config/severity.config'
import { POSTGRES_MIGRATIONS } from '../../../src/main/storage/postgres/migrations/definitions'
import { PostgresMigrationRunner } from '../../../src/main/storage/postgres/migrations/PostgresMigrationRunner'
import { fillClinvarSeverityLookup } from '../../../src/main/storage/postgres/migrations/severity-rank-backfill'
import { carrierRanks } from '../../../src/main/storage/postgres/cohort-summary-representative-sql'
import { prepareCohortRead } from '../../../src/main/storage/postgres/cohort-read-freshness'
import { PostgresCohortSummaryRepository } from '../../../src/main/storage/postgres/PostgresCohortSummaryRepository'
import { PostgresVariantReadRepository } from '../../../src/main/storage/postgres/PostgresVariantReadRepository'
import {
  awaitSeverityRankBackfill,
  runSeverityRankBackfillBatch
} from '../../../src/main/storage/postgres/severity-rank-backfill-job'

const RUN = process.env.VARLENS_RUN_POSTGRES_E2E === '1'
const PG_URL =
  process.env.VARLENS_PG_URL ??
  'postgres://varlens:varlens_dev_password@127.0.0.1:55432/varlens_dev'

const BEFORE_0025 = POSTGRES_MIGRATIONS.filter((migration) => migration.version < '0025')

/** Legacy rows: [consequence (impact), clinvar]. */
const LEGACY: Array<[string | null, string | null]> = [
  ['HIGH', 'Pathogenic'],
  ['MODERATE', 'Pathogenic/Likely_pathogenic'],
  ['LOW', 'Conflicting_interpretations_of_pathogenicity'],
  ['MODIFIER', 'uncertain_significance&likely_benign'],
  [' high ', 'Benign/Likely_benign|other'],
  ['missense_variant', 'something new'],
  [null, null],
  ['MODIFIER', 'not_provided'],
  ['HIGH', "it's a 'quoted' value, benign"]
]

describe.skipIf(!RUN)('migration 0025: annotation severity ranks (#469)', () => {
  let schema: string
  let pool: Pool
  let probe: Client

  beforeEach(async () => {
    schema = `varlens_test_sev_${Date.now()}_${randomBytes(4).toString('hex')}`
    const provisioner = new Client({ connectionString: PG_URL })
    await provisioner.connect()
    await provisioner.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`)
    await provisioner.end()

    pool = new Pool({ connectionString: PG_URL, max: 2 })
    probe = new Client({ connectionString: PG_URL })
    await probe.connect()
  }, 60_000)

  afterEach(async () => {
    if (probe) await probe.end()
    if (pool) await pool.end()
    const cleaner = new Client({ connectionString: PG_URL })
    await cleaner.connect()
    await cleaner.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    await cleaner.end()
  }, 60_000)

  async function seedLegacy(): Promise<void> {
    await new PostgresMigrationRunner(pool, schema, BEFORE_0025).migrate()
    const ready = await probe.query<{ id: number }>(
      `INSERT INTO "${schema}".cases (name, file_path, file_size, created_at, genome_build)
       VALUES ('legacy', '/tmp/legacy.vcf', 0, 0, 'GRCh38') RETURNING id`
    )
    for (const [index, [consequence, clinvar]] of LEGACY.entries()) {
      await probe.query(
        `INSERT INTO "${schema}".variants
           (case_id, chr, pos, ref, alt, variant_type, consequence, clinvar, gt_num)
         VALUES ($1, '1', $2, 'A', 'T', 'snv', $3, $4, '0/1')`,
        [ready.rows[0].id, 100 + index, consequence, clinvar]
      )
    }
  }

  const ranks = async (relation = 'variants'): Promise<unknown[]> =>
    (
      await probe.query(
        `SELECT consequence, clinvar, impact_rank, clinvar_rank
           FROM "${schema}"."${relation}" ORDER BY pos`
      )
    ).rows

  const expectedRanks = LEGACY.map(([consequence, clinvar]) => ({
    consequence,
    clinvar,
    impact_rank: impactRank(consequence),
    clinvar_rank: clinvarRank(clinvar)
  }))

  const storedRanks = async (): Promise<unknown[]> =>
    (
      await probe.query(
        `SELECT impact_rank, clinvar_rank FROM "${schema}".variants_all ORDER BY pos`
      )
    ).rows
  const backfillState = async (): Promise<unknown> =>
    (
      await probe.query(
        `SELECT next_id::int, max_id::int, completed_at IS NOT NULL AS done
           FROM "${schema}".severity_rank_backfill WHERE id = 1`
      )
    ).rows[0]
  /** The ranks every reader sees, backfilled or not. */
  const effectiveRanks = async (): Promise<unknown[]> => {
    const ranksOf = carrierRanks('v', (table) => `"${schema}"."${table}"`)
    return (
      await probe.query(
        `SELECT v.consequence, v.clinvar, ${ranksOf.impact} AS impact_rank,
                ${ranksOf.clinvar} AS clinvar_rank
           FROM "${schema}".variants v ORDER BY v.pos`
      )
    ).rows
  }

  it('adds the columns without rewriting or updating the variants table', async () => {
    await seedLegacy()
    const storage = async (): Promise<unknown> =>
      (
        await probe.query(
          `SELECT c.relfilenode, (SELECT array_agg(xmin::text ORDER BY id)
                                    FROM "${schema}".variants_all) AS row_versions
             FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = $1 AND c.relname = 'variants_all'`,
          [schema]
        )
      ).rows[0]
    const before = await storage()

    await new PostgresMigrationRunner(pool, schema, POSTGRES_MIGRATIONS).migrate()

    // Same file, same row versions: a catalogue change only.
    expect(await storage()).toEqual(before)
    expect(await storedRanks()).toEqual(
      LEGACY.map(() => ({ impact_rank: null, clinvar_rank: null }))
    )
    const maxId = (await probe.query(`SELECT MAX(id)::int AS id FROM "${schema}".variants_all`))
      .rows[0].id
    expect(await backfillState()).toEqual({ next_id: 0, max_id: maxId, done: false })
  }, 60_000)

  it('readers get the right ranks before any row is backfilled', async () => {
    await seedLegacy()
    await new PostgresMigrationRunner(pool, schema, POSTGRES_MIGRATIONS).migrate()

    expect(await effectiveRanks()).toEqual(expectedRanks)
    // Not all zero, or the comparison above would prove nothing.
    expect(expectedRanks.slice(0, 5)).toEqual([
      expect.objectContaining({ impact_rank: 4, clinvar_rank: 15 }),
      expect.objectContaining({ impact_rank: 3, clinvar_rank: 14 }),
      expect.objectContaining({ impact_rank: 2, clinvar_rank: 12 }),
      expect.objectContaining({ impact_rank: 1, clinvar_rank: 11 }),
      expect.objectContaining({ impact_rank: 4, clinvar_rank: 3 })
    ])
    // The lookup holds exactly the stored strings that have a rank.
    const lookup = await probe.query(
      `SELECT raw, rank FROM "${schema}".clinvar_severity ORDER BY raw COLLATE "C"`
    )
    expect(lookup.rows).toEqual(
      LEGACY.map(([, clinvar]) => clinvar)
        .filter((clinvar): clinvar is string => clinvar !== null && clinvarRank(clinvar) > 0)
        .sort()
        .map((raw) => ({ raw, rank: clinvarRank(raw) }))
    )

    // A summary rebuilt now, and the case view sorted by impact, are already right.
    const client = await pool.connect()
    try {
      await new PostgresCohortSummaryRepository().rebuild({ schema, client: client as never })
    } finally {
      client.release()
    }
    const summary = await probe.query(
      `SELECT consequence, clinvar, impact_rank, clinvar_rank
         FROM "${schema}".cohort_variant_summary ORDER BY pos`
    )
    expect(summary.rows).toEqual(expectedRanks)
    const sorted = await new PostgresVariantReadRepository(pool, schema).queryVariants(
      { case_id: 1 },
      50,
      0,
      [{ key: 'consequence', order: 'desc' }]
    )
    expect(
      sorted.data
        .slice(0, 3)
        .map((variant) => variant.consequence)
        .sort()
    ).toEqual([' high ', 'HIGH', 'HIGH'])
  }, 60_000)

  it('backfills in resumable id-range batches, each its own transaction', async () => {
    await seedLegacy()
    await new PostgresMigrationRunner(pool, schema, POSTGRES_MIGRATIONS).migrate()
    const scope = { pool, schema }
    const maxId = LEGACY.length

    // One batch of four ids: four rows done, progress recorded, not complete.
    expect(await runSeverityRankBackfillBatch(scope, 4)).toEqual({ nextId: 4, maxId, done: false })
    expect(
      (await storedRanks()).filter((row) => (row as { impact_rank: unknown }).impact_rank !== null)
    ).toHaveLength(4)
    expect(await backfillState()).toEqual({ next_id: 4, max_id: maxId, done: false })
    expect(await effectiveRanks()).toEqual(expectedRanks)

    // A new process resumes from the recorded id.
    let progress = await runSeverityRankBackfillBatch(scope, 4)
    while (progress !== null && !progress.done)
      progress = await runSeverityRankBackfillBatch(scope, 4)
    expect(await backfillState()).toEqual({ next_id: maxId, max_id: maxId, done: true })
    expect(await ranks('variants_all')).toEqual(expectedRanks)

    // Complete: another call writes nothing.
    const versions = async (): Promise<unknown[]> =>
      (await probe.query(`SELECT id, xmin::text FROM "${schema}".variants_all ORDER BY id`)).rows
    const before = await versions()
    expect(await runSeverityRankBackfillBatch(scope, 4)).toMatchObject({ done: true })
    expect(await versions()).toEqual(before)
  }, 60_000)

  it('a cohort read starts the backfill in the background and it completes', async () => {
    await seedLegacy()
    await new PostgresMigrationRunner(pool, schema, POSTGRES_MIGRATIONS).migrate()

    await prepareCohortRead({ pool, schema })
    await awaitSeverityRankBackfill(schema)

    expect(await backfillState()).toMatchObject({ done: true })
    expect(await ranks('variants_all')).toEqual(expectedRanks)
  }, 60_000)

  it('rows imported after the migration are never touched by the backfill', async () => {
    await new PostgresMigrationRunner(pool, schema, POSTGRES_MIGRATIONS).migrate()
    // An empty table has nothing to backfill.
    expect(await backfillState()).toEqual({ next_id: 0, max_id: 0, done: true })
  }, 60_000)

  it('refreshing the lookup again changes nothing', async () => {
    await seedLegacy()
    await new PostgresMigrationRunner(pool, schema, POSTGRES_MIGRATIONS).migrate()
    const lookup = async (): Promise<unknown[]> =>
      (await probe.query(`SELECT raw, rank FROM "${schema}".clinvar_severity ORDER BY raw`)).rows
    const before = await lookup()
    await fillClinvarSeverityLookup(probe, schema)
    expect(await lookup()).toEqual(before)
  }, 60_000)

  it('adds nullable rank columns to variants and NOT NULL ones to the summary', async () => {
    await new PostgresMigrationRunner(pool, schema, POSTGRES_MIGRATIONS).migrate()
    const columns = await probe.query(
      `SELECT table_name, column_name, data_type, is_nullable, column_default
         FROM information_schema.columns
        WHERE table_schema = $1 AND column_name IN ('impact_rank', 'clinvar_rank')
          AND table_name IN ('variants_all', 'variants', 'cohort_variant_summary')
        ORDER BY table_name, column_name`,
      [schema]
    )
    const column = (table: string, name: string, nullable: boolean): unknown => ({
      table_name: table,
      column_name: name,
      data_type: 'smallint',
      is_nullable: nullable ? 'YES' : 'NO',
      column_default: nullable ? null : '0'
    })
    expect(columns.rows).toEqual([
      column('cohort_variant_summary', 'clinvar_rank', false),
      column('cohort_variant_summary', 'impact_rank', false),
      column('variants', 'clinvar_rank', true),
      column('variants', 'impact_rank', true),
      column('variants_all', 'clinvar_rank', true),
      column('variants_all', 'impact_rank', true)
    ])
  }, 60_000)

  it('flags a populated summary stale without calling it never rebuilt', async () => {
    await seedLegacy()
    await probe.query(
      `UPDATE "${schema}".cohort_summary_state
          SET is_stale = false, stale_reason = NULL, last_rebuilt_at = NULL WHERE id = 1`
    )
    await probe.query(
      `INSERT INTO "${schema}".cohort_variant_summary
         (chr, pos, ref, alt, variant_type, genome_build, carrier_count, het_count, hom_count, variant_key)
       VALUES ('1', 100, 'A', 'T', 'snv', 'GRCh38', 1, 1, 0, '1:100:A:T')`
    )
    await new PostgresMigrationRunner(pool, schema, POSTGRES_MIGRATIONS).migrate()

    const state = await probe.query(
      `SELECT is_stale, stale_reason, last_rebuilt_at IS NOT NULL AS rebuilt_before
         FROM "${schema}".cohort_summary_state WHERE id = 1`
    )
    expect(state.rows[0]).toEqual({
      is_stale: true,
      stale_reason: 'migration_0025_representative_severity',
      rebuilt_before: true
    })
  }, 60_000)

  it('leaves an empty summary current', async () => {
    await new PostgresMigrationRunner(pool, schema, POSTGRES_MIGRATIONS).migrate()
    const state = await probe.query(
      `SELECT is_stale FROM "${schema}".cohort_summary_state WHERE id = 1`
    )
    expect(state.rows[0]).toEqual({ is_stale: false })
  }, 60_000)
})
