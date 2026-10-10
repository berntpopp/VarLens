/**
 * The burden-test matrix on PostgreSQL is the matrix on SQLite: same sites,
 * same dosages, same frequencies, same exclusion counts (#520).
 * Fixture: tests/main/database/support/burden-fixture.ts.
 *
 * Gated by VARLENS_RUN_POSTGRES_E2E=1 against a real PostgreSQL.
 */
import { randomBytes } from 'node:crypto'

import Database from 'better-sqlite3-multiple-ciphers'
import { Pool } from 'pg'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { AssociationDataBuilder } from '../../../src/main/database/AssociationDataBuilder'
import { runMigrations } from '../../../src/main/database/migrations'
import { initializeSchema } from '../../../src/main/database/schema'
import type { VariantFilters } from '../../../src/main/statistics/types'
import { POSTGRES_MIGRATIONS } from '../../../src/main/storage/postgres/migrations/definitions'
import { PostgresMigrationRunner } from '../../../src/main/storage/postgres/migrations/PostgresMigrationRunner'
import { PostgresAssociationDataBuilder } from '../../../src/main/storage/postgres/PostgresAssociationDataBuilder'
import {
  BURDEN_ROWS,
  EXPECTED_GENES,
  EXPECTED_NON_AUTOSOMAL,
  SAMPLES,
  projectGenes,
  seedSqlite,
  type Sample
} from '../database/support/burden-fixture'

const RUN = process.env.VARLENS_RUN_POSTGRES_E2E === '1'
const PG_URL =
  process.env.VARLENS_PG_URL ??
  'postgres://varlens:varlens_dev_password@127.0.0.1:55432/varlens_dev'

const MIXED_BUILDS =
  'Mixed genome builds: the selected cases use GRCh37 and GRCh38. ' +
  'Run the burden test on cases of one genome build.'

describe.skipIf(!RUN)('burden test matrix: PostgreSQL equals SQLite', () => {
  let schema: string
  let pool: Pool
  let ids: Record<Sample, number>
  let sqliteDb: Database.Database
  let sqliteIds: Record<Sample, number>

  beforeEach(async () => {
    schema = `parity_${randomBytes(4).toString('hex')}`
    pool = new Pool({ connectionString: PG_URL })

    await pool.query(`CREATE SCHEMA "${schema}"`)
    const runner = new PostgresMigrationRunner(pool, schema, POSTGRES_MIGRATIONS)
    await runner.migrate()

    ids = {} as Record<Sample, number>
    for (const sample of SAMPLES) {
      const { rows } = await pool.query(
        `INSERT INTO "${schema}".cases (name, file_path, file_size, variant_count, created_at) VALUES ($1, '/b.vcf', 0, 0, 0) RETURNING id`,
        [sample]
      )
      ids[sample] = Number(rows[0].id)
    }

    const pgInsert = `INSERT INTO "${schema}".variants (case_id, chr, pos, ref, alt, gene_symbol, gt_num, qual) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`
    for (const r of BURDEN_ROWS) {
      await pool.query(pgInsert, [ids[r.sample], r.chr, r.pos, r.ref, r.alt, r.gene, r.gt, r.qual])
    }

    sqliteDb = new Database(':memory:')
    initializeSchema(sqliteDb)
    runMigrations(sqliteDb)
    sqliteIds = seedSqlite(sqliteDb)
  })

  afterEach(async () => {
    if (pool) {
      await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
      await pool.end()
    }
  })

  const sqliteBuild = (filters: VariantFilters) =>
    new AssociationDataBuilder(sqliteDb).build(
      [sqliteIds.S1, sqliteIds.S2],
      [sqliteIds.S3, sqliteIds.S4],
      filters,
      []
    )

  const pgBuild = (filters: VariantFilters) =>
    new PostgresAssociationDataBuilder(pool, schema).build(
      [ids.S1, ids.S2],
      [ids.S3, ids.S4],
      filters,
      []
    )

  it('matches the SQLite matrix for the same case selection', async () => {
    const built = await pgBuild({})
    expect(projectGenes(built.genes)).toEqual(EXPECTED_GENES)
    expect(built.non_autosomal_variants).toBe(EXPECTED_NON_AUTOSOMAL)

    const expected = sqliteBuild({})
    expect(built.non_autosomal_variants).toBe(expected.non_autosomal_variants)
    expect(built.genes).toEqual(expected.genes)
  })

  it('drops column-filtered sites exactly like SQLite', async () => {
    const filters: VariantFilters = {
      column_filters: { qual: { operator: '>=', value: 20, includeEmpty: false } }
    }
    const built = await pgBuild(filters)
    expect(projectGenes(built.genes)).toEqual(EXPECTED_GENES)

    expect(built.genes).toEqual(sqliteBuild(filters).genes)
  })

  it('rejects mixed genome builds, exactly like SQLite', async () => {
    await pool.query(`UPDATE "${schema}".cases SET genome_build = 'GRCh37' WHERE id = $1`, [ids.S4])
    await expect(pgBuild({})).rejects.toThrow(MIXED_BUILDS)
  })

  it('binds case ids as one Postgres array', async () => {
    const many = Array.from({ length: 20_000 }, (_, i) => i + 1000)
    await expect(
      new PostgresAssociationDataBuilder(pool, schema).build(many, [ids.S1], {}, [])
    ).resolves.toBeDefined()
  })
})
