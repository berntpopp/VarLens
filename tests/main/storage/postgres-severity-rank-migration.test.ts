/**
 * Migration 0025 (#469) against a real PostgreSQL: the severity rank columns,
 * the backfill of rows imported before the ranks existed, and the stale flag
 * that makes the summary pick its representative again.
 *
 * Gated by VARLENS_RUN_POSTGRES_E2E=1. Requires `make pg-up`.
 */
import { randomBytes } from 'node:crypto'

import { Client, Pool } from 'pg'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { clinvarRank, impactRank } from '../../../src/shared/config/severity.config'
import { POSTGRES_MIGRATIONS } from '../../../src/main/storage/postgres/migrations/definitions'
import { PostgresMigrationRunner } from '../../../src/main/storage/postgres/migrations/PostgresMigrationRunner'
import { backfillSeverityRanks } from '../../../src/main/storage/postgres/migrations/severity-rank-backfill'

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

  it('backfills legacy rows with the ranks an import would have written', async () => {
    await seedLegacy()
    await new PostgresMigrationRunner(pool, schema, POSTGRES_MIGRATIONS).migrate()

    // The view exposes the columns too: the summary reads through it.
    expect(await ranks('variants')).toEqual(expectedRanks)
    expect(await ranks('variants_all')).toEqual(expectedRanks)
    // Not all zero, or the comparison above would prove nothing.
    expect(expectedRanks.slice(0, 5)).toEqual([
      expect.objectContaining({ impact_rank: 4, clinvar_rank: 15 }),
      expect.objectContaining({ impact_rank: 3, clinvar_rank: 14 }),
      expect.objectContaining({ impact_rank: 2, clinvar_rank: 12 }),
      expect.objectContaining({ impact_rank: 1, clinvar_rank: 11 }),
      expect.objectContaining({ impact_rank: 4, clinvar_rank: 6 })
    ])
  }, 60_000)

  it('run again it updates no row, and corrects a row whose rank is wrong', async () => {
    await seedLegacy()
    await new PostgresMigrationRunner(pool, schema, POSTGRES_MIGRATIONS).migrate()
    const versions = async (): Promise<unknown[]> =>
      (await probe.query(`SELECT id, xmin::text FROM "${schema}".variants_all ORDER BY id`)).rows
    const before = await versions()
    const rerun = async (): Promise<void> => {
      await probe.query('BEGIN')
      await backfillSeverityRanks(probe, schema)
      await probe.query('COMMIT')
    }

    await rerun()
    expect(await versions()).toEqual(before)
    expect(await ranks()).toEqual(expectedRanks)

    await probe.query(
      `UPDATE "${schema}".variants_all SET impact_rank = 0, clinvar_rank = 9 WHERE pos = 100`
    )
    await rerun()
    expect(await ranks()).toEqual(expectedRanks)
  }, 60_000)

  it('keeps every row, index and generated column through the rewrite', async () => {
    await seedLegacy()
    const snapshot = async (): Promise<unknown> => ({
      rows: (
        await probe.query(
          `SELECT id, case_id, chr, pos, ref, alt, consequence, clinvar, gt_num, coord_hash,
                  search_document::text AS search_document
             FROM "${schema}".variants_all ORDER BY id`
        )
      ).rows,
      indexes: (
        await probe.query(
          `SELECT indexname, indexdef FROM pg_indexes
            WHERE schemaname = $1 AND tablename = 'variants_all' ORDER BY indexname`,
          [schema]
        )
      ).rows
    })
    const before = await snapshot()

    await new PostgresMigrationRunner(pool, schema, POSTGRES_MIGRATIONS).migrate()

    expect(await snapshot()).toEqual(before)
    // A case that is still importing stays hidden behind the redefined view.
    await probe.query(`UPDATE "${schema}".cases_all SET import_status = 'importing'`)
    expect(await ranks('variants')).toEqual([])
    expect(await ranks('variants_all')).toEqual(expectedRanks)
  }, 60_000)

  it('adds NOT NULL rank columns defaulting to 0 to variants and the summary', async () => {
    await new PostgresMigrationRunner(pool, schema, POSTGRES_MIGRATIONS).migrate()
    const columns = await probe.query(
      `SELECT table_name, column_name, data_type, is_nullable, column_default
         FROM information_schema.columns
        WHERE table_schema = $1 AND column_name IN ('impact_rank', 'clinvar_rank')
          AND table_name IN ('variants_all', 'cohort_variant_summary')
        ORDER BY table_name, column_name`,
      [schema]
    )
    expect(columns.rows).toEqual(
      ['cohort_variant_summary', 'variants_all'].flatMap((table) =>
        ['clinvar_rank', 'impact_rank'].map((column) => ({
          table_name: table,
          column_name: column,
          data_type: 'smallint',
          is_nullable: 'NO',
          column_default: '0'
        }))
      )
    )
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
