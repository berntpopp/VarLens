/**
 * Migration 0037 (#573) against a real PostgreSQL: per-case filter metadata
 * written before it held no bounds for end_pos and sv_length (reported as
 * text); after it both are numeric with min/max, sv_length unsigned, as on
 * SQLite.
 *
 * Gated by VARLENS_RUN_POSTGRES_E2E=1. Requires `make pg-up`.
 */
import { randomBytes } from 'node:crypto'

import { Pool } from 'pg'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { POSTGRES_MIGRATIONS } from '../../../src/main/storage/postgres/migrations/definitions'
import { PostgresMigrationRunner } from '../../../src/main/storage/postgres/migrations/PostgresMigrationRunner'
import { PostgresCohortSummaryRepository } from '../../../src/main/storage/postgres/PostgresCohortSummaryRepository'
import { PostgresVariantReadRepository } from '../../../src/main/storage/postgres/PostgresVariantReadRepository'

const RUN = process.env.VARLENS_RUN_POSTGRES_E2E === '1'
const PG_URL =
  process.env.VARLENS_PG_URL ??
  'postgres://varlens:varlens_dev_password@127.0.0.1:55432/varlens_dev'

describe.skipIf(!RUN)('migration 0037: per-case end_pos / sv_length bounds', () => {
  let schema: string
  let pool: Pool

  beforeEach(async () => {
    schema = `varlens_test_0037_${randomBytes(4).toString('hex')}`
    pool = new Pool({ connectionString: PG_URL, max: 2 })
    await pool.query(`CREATE SCHEMA "${schema}"`)
    const before = POSTGRES_MIGRATIONS.filter((migration) => migration.version < '0037')
    await new PostgresMigrationRunner(pool, schema, before).migrate()
  }, 120_000)

  afterEach(async () => {
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    await pool.end()
  }, 60_000)

  it('fills numeric, unsigned bounds into metadata written before', async () => {
    const caseId = Number(
      (
        await pool.query<{ id: string }>(
          `INSERT INTO "${schema}".cases (name, file_path, file_size, created_at, genome_build)
           VALUES ('old', '/old.vcf', 0, 0, 'GRCh38') RETURNING id`
        )
      ).rows[0].id
    )
    await pool.query(
      `INSERT INTO "${schema}".variants (case_id, chr, pos, ref, alt, variant_type, end_pos, sv_length, gt_num)
       VALUES ($1, '1', 1000, 'N', '<DEL>', 'sv', 5000, -4000, '0/1'),
              ($1, '1', 2000, 'N', '<INS>', 'sv', NULL, 300, '0/1')`,
      [caseId]
    )
    const client = await pool.connect()
    try {
      await new PostgresCohortSummaryRepository().refreshColumnMetas({
        schema,
        client: client as never,
        caseId
      })
    } finally {
      client.release()
    }
    // As the previous version wrote them: no bounds for end_pos / sv_length.
    await pool.query(
      `UPDATE "${schema}".cohort_column_meta SET min_value = NULL, max_value = NULL
        WHERE column_name IN ('end_pos', 'sv_length')`
    )

    await new PostgresMigrationRunner(pool, schema, POSTGRES_MIGRATIONS).migrate()

    const repo = new PostgresVariantReadRepository(pool, schema)
    expect(await repo.getColumnMeta({ caseId }, 'sv_length')).toMatchObject({
      dataType: 'numeric',
      min: 300,
      max: 4000
    })
    expect(await repo.getColumnMeta({ caseId }, 'end_pos')).toMatchObject({
      dataType: 'numeric',
      min: 5000,
      max: 5000
    })
    const options = await repo.getFilterOptions(caseId)
    const kinds = Object.fromEntries(options.columnMeta.map((m) => [m.key, m.dataType]))
    expect(kinds).toMatchObject({ end_pos: 'numeric', sv_length: 'numeric' })
  }, 120_000)
})
