/**
 * Sprint A PR-3 C1 — cohort_summary migration (0010) against a real Postgres.
 *
 * Verifies the three tables (cohort_variant_summary, cohort_column_meta,
 * cohort_summary_state), the six-index set mirroring SQLite v25 (Pass-3 LOW #7),
 * the composite PK including (variant_type, genome_build) (Codex finding 1),
 * and the conditional seed semantics (Pass-9 #5): fresh schemas seed
 * is_stale=false; existing-data schemas seed is_stale=true with reason
 * 'migration_initial_existing_data'.
 *
 * Gated by VARLENS_RUN_POSTGRES_E2E=1. Requires `make pg-up`.
 */
import { randomBytes } from 'node:crypto'

import { Client, Pool } from 'pg'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { POSTGRES_MIGRATIONS } from '../../../src/main/storage/postgres/migrations/definitions'
import { PostgresMigrationRunner } from '../../../src/main/storage/postgres/migrations/PostgresMigrationRunner'

const RUN = process.env.VARLENS_RUN_POSTGRES_E2E === '1'
const PG_URL =
  process.env.VARLENS_PG_URL ??
  'postgres://varlens:varlens_dev_password@127.0.0.1:55432/varlens_dev'

const MIGRATIONS_THROUGH_0009 = POSTGRES_MIGRATIONS.filter((m) => m.version < '0010')

describe.skipIf(!RUN)('cohort_summary migration — Sprint A C1', () => {
  let schema: string
  let pool: Pool
  let probe: Client

  beforeEach(async () => {
    schema = `varlens_test_cvs_${Date.now()}_${randomBytes(4).toString('hex')}`
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

  it('creates cohort_variant_summary with the v25-mirroring index set', async () => {
    await new PostgresMigrationRunner(pool, schema, POSTGRES_MIGRATIONS).migrate()

    const tablesRes = await probe.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = $1`,
      [schema]
    )
    const tableNames = tablesRes.rows.map((r) => r.table_name)
    expect(tableNames).toContain('cohort_variant_summary')
    expect(tableNames).toContain('cohort_column_meta')
    expect(tableNames).toContain('cohort_summary_state')

    const indexRes = await probe.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE schemaname = $1 AND tablename = 'cohort_variant_summary'`,
      [schema]
    )
    const indexNames = indexRes.rows.map((r) => r.indexname)
    for (const expected of [
      'idx_cvs_carrier',
      'idx_cvs_filters',
      'idx_cvs_covering_common',
      'idx_cvs_gene_covering',
      'idx_cvs_type_build'
    ]) {
      expect(indexNames, `index ${expected} must exist`).toContain(expected)
    }
    // 0022: cohort frequency is derived at read time, so nothing indexes it.
    expect(indexNames).not.toContain('idx_cvs_cohort_freq')
  }, 60_000)

  it('leaves free space on the counter tables so their updates stay heap-only (0024)', async () => {
    await new PostgresMigrationRunner(pool, schema, POSTGRES_MIGRATIONS).migrate()

    const res = await probe.query<{ relname: string; reloptions: string[] | null }>(
      `SELECT c.relname, c.reloptions
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = $1 AND c.relname = ANY($2)`,
      [schema, ['variant_frequency', 'cohort_gene_variant_summary', 'cohort_gene_summary']]
    )
    const fillfactor = new Map(
      res.rows.map((row) => [
        row.relname,
        (row.reloptions ?? []).find((option) => option.startsWith('fillfactor='))
      ])
    )
    expect(fillfactor.get('variant_frequency')).toBe('fillfactor=85')
    expect(fillfactor.get('cohort_gene_variant_summary')).toBe('fillfactor=85')
    expect(fillfactor.get('cohort_gene_summary')).toBe('fillfactor=50')

    // A counter bump on a freshly written row is a heap-only update.
    await probe.query(
      `INSERT INTO "${schema}".cohort_gene_summary
         (gene_symbol, variant_count, unique_variant_count, affected_case_count)
       SELECT 'GENE' || g, 1, 1, 1 FROM generate_series(1, 2000) g`
    )
    await probe.query(
      `UPDATE "${schema}".cohort_gene_summary SET variant_count = variant_count + 1`
    )
    await probe.query('SELECT pg_stat_force_next_flush()')
    const stats = await probe.query<{ n_tup_upd: string; n_tup_hot_upd: string }>(
      `SELECT n_tup_upd, n_tup_hot_upd FROM pg_stat_xact_user_tables
        WHERE schemaname = $1 AND relname = 'cohort_gene_summary'`,
      [schema]
    )
    void stats
    const flushed = await probe.query<{ n_tup_upd: string; n_tup_hot_upd: string }>(
      `SELECT n_tup_upd, n_tup_hot_upd FROM pg_stat_user_tables
        WHERE schemaname = $1 AND relname = 'cohort_gene_summary'`,
      [schema]
    )
    expect(Number(flushed.rows[0].n_tup_upd)).toBe(2000)
    expect(Number(flushed.rows[0].n_tup_hot_upd)).toBeGreaterThan(1900)
  }, 60_000)

  it('flags an existing summary for a rebuild under the MAX-per-column rule (0024, #461)', async () => {
    const before0024 = POSTGRES_MIGRATIONS.filter((migration) => migration.version < '0024')
    await new PostgresMigrationRunner(pool, schema, before0024).migrate()
    await probe.query(
      `UPDATE "${schema}".cohort_summary_state SET is_stale = false, stale_reason = NULL WHERE id = 1`
    )
    await probe.query(
      `INSERT INTO "${schema}".cohort_variant_summary
         (chr, pos, ref, alt, variant_type, genome_build, carrier_count, het_count, hom_count, variant_key)
       VALUES ('1', 100, 'A', 'T', 'snv', 'GRCh38', 1, 1, 0, '1:100:A:T')`
    )

    await new PostgresMigrationRunner(pool, schema, POSTGRES_MIGRATIONS).migrate()

    const res = await probe.query<{ is_stale: boolean; stale_reason: string | null }>(
      `SELECT is_stale, stale_reason FROM "${schema}".cohort_summary_state WHERE id = 1`
    )
    expect(res.rows[0]).toEqual({
      is_stale: true,
      stale_reason: 'migration_0024_representative_annotation'
    })
  }, 60_000)

  it('seeds cohort_summary_state with is_stale=false on a fresh schema (no variants)', async () => {
    await new PostgresMigrationRunner(pool, schema, POSTGRES_MIGRATIONS).migrate()

    const res = await probe.query<{ is_stale: boolean; stale_reason: string | null }>(
      `SELECT is_stale, stale_reason FROM "${schema}".cohort_summary_state WHERE id = 1`
    )
    expect(res.rows).toHaveLength(1)
    expect(res.rows[0].is_stale).toBe(false)
    expect(res.rows[0].stale_reason).toBeNull()
  }, 60_000)

  it('seeds cohort_summary_state with is_stale=true on an existing-data schema (Pass-9 #5)', async () => {
    // Apply 0001-0009 first, insert a case + one variant, THEN apply 0010.
    await new PostgresMigrationRunner(pool, schema, MIGRATIONS_THROUGH_0009).migrate()

    const caseRes = await probe.query<{ id: number }>(
      `INSERT INTO "${schema}".cases (name, file_path, file_size, created_at)
         VALUES ('seed-case', '/tmp/seed.json', 0, $1) RETURNING id`,
      [Date.now()]
    )
    const caseId = caseRes.rows[0].id
    await probe.query(
      `INSERT INTO "${schema}".variants (case_id, chr, pos, ref, alt)
         VALUES ($1, '1', 100, 'A', 'T')`,
      [caseId]
    )

    await new PostgresMigrationRunner(pool, schema, POSTGRES_MIGRATIONS).migrate()

    const res = await probe.query<{ is_stale: boolean; stale_reason: string | null }>(
      `SELECT is_stale, stale_reason FROM "${schema}".cohort_summary_state WHERE id = 1`
    )
    expect(res.rows).toHaveLength(1)
    expect(res.rows[0].is_stale).toBe(true)
    expect(res.rows[0].stale_reason).toBe('migration_initial_existing_data')
  }, 60_000)

  it('PK includes variant_type AND genome_build (Codex finding 1)', async () => {
    await new PostgresMigrationRunner(pool, schema, POSTGRES_MIGRATIONS).migrate()

    const pkRes = await probe.query<{ column_name: string }>(
      `SELECT kcu.column_name
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           USING (constraint_schema, constraint_name)
        WHERE tc.table_schema = $1
          AND tc.table_name = 'cohort_variant_summary'
          AND tc.constraint_type = 'PRIMARY KEY'`,
      [schema]
    )
    const pkCols = pkRes.rows.map((r) => r.column_name)
    expect(pkCols).toEqual(
      expect.arrayContaining(['chr', 'pos', 'ref', 'alt', 'variant_type', 'genome_build'])
    )
    expect(pkCols).toHaveLength(6)
  }, 60_000)
})

describe.skipIf(RUN)('cohort_summary migration — Sprint A C1 (skipped)', () => {
  it('runs only when VARLENS_RUN_POSTGRES_E2E=1 and `make pg-up` is up', () => {
    expect(RUN).toBe(false)
  })
})
