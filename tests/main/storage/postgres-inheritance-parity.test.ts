/**
 * Inheritance filters that must select the same proband rows on SQLite and
 * PostgreSQL: trio modes without a family fail closed (#553), and candidate
 * compound het counts only the rows the other filters keep (#579).
 *
 * Gated by VARLENS_RUN_POSTGRES_E2E=1 against a real PostgreSQL.
 */
import { randomBytes } from 'node:crypto'

import { Pool } from 'pg'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { makeVariant } from '../../utils/make-variant'

import { DatabaseService } from '../../../src/main/database'
import type { VariantFilter } from '../../../src/shared/types/database'
import { POSTGRES_MIGRATIONS } from '../../../src/main/storage/postgres/migrations/definitions'
import { PostgresMigrationRunner } from '../../../src/main/storage/postgres/migrations/PostgresMigrationRunner'
import { PostgresVariantReadRepository } from '../../../src/main/storage/postgres/PostgresVariantReadRepository'

const RUN = process.env.VARLENS_RUN_POSTGRES_E2E === '1'
const PG_URL =
  process.env.VARLENS_PG_URL ??
  'postgres://varlens:varlens_dev_password@127.0.0.1:55432/varlens_dev'

const RARE = { gnomad_af: 0.0001, consequence: 'HIGH', func: 'stop_gained' }
const COMMON = { gnomad_af: 0.3, consequence: 'LOW', func: 'synonymous_variant' }

type Row = { pos: number; gene: string; gt: string } & typeof RARE

describe.skipIf(!RUN)('inheritance filters select the same rows on both backends', () => {
  let schema: string
  let pool: Pool
  let sqlite: DatabaseService
  let sqliteCase: number
  let pgCase: number

  beforeEach(async () => {
    schema = `varlens_test_inherit_${Date.now()}_${randomBytes(4).toString('hex')}`
    pool = new Pool({ connectionString: PG_URL, max: 2 })
    await pool.query(`CREATE SCHEMA "${schema}"`)
    await new PostgresMigrationRunner(pool, schema, POSTGRES_MIGRATIONS).migrate()
    sqlite = new DatabaseService(':memory:')
    sqliteCase = sqlite.cases.createCase('proband', '/p.json', 1)
    pgCase = Number(
      (
        await pool.query<{ id: string }>(
          `INSERT INTO "${schema}".cases (name, file_path, file_size, created_at, genome_build)
           VALUES ('proband', '/p.json', 0, 0, 'GRCh38') RETURNING id`
        )
      ).rows[0].id
    )
    await seed([
      { pos: 100, gene: 'GENE1', gt: '0/1', ...RARE },
      { pos: 200, gene: 'GENE1', gt: '0/1', ...COMMON },
      { pos: 300, gene: 'GENE2', gt: '0/1', ...RARE },
      { pos: 400, gene: 'GENE2', gt: '0/1', ...RARE },
      { pos: 500, gene: 'GENE3', gt: '1/1', ...RARE }
    ])
  }, 60_000)

  afterEach(async () => {
    sqlite?.close()
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    await pool.end()
  }, 60_000)

  async function seed(rows: Row[]): Promise<void> {
    for (const { pos, gene, gt, gnomad_af, consequence, func } of rows) {
      sqlite.variants.insertVariantsBatch(sqliteCase, [
        makeVariant({ pos, gene_symbol: gene, gt_num: gt, gnomad_af, consequence, func })
      ])
      await pool.query(
        `INSERT INTO "${schema}".variants
           (case_id, chr, pos, ref, alt, variant_type, gene_symbol, gt_num, gnomad_af, consequence, func)
         VALUES ($1, '1', $2, 'A', 'G', 'snv', $3, $4, $5, $6, $7)`,
        [pgCase, pos, gene, gt, gnomad_af, consequence, func]
      )
    }
  }

  /** Proband positions the filter keeps, asserted equal on both backends. */
  async function matching(filter: Omit<VariantFilter, 'case_id'>): Promise<number[]> {
    const lite = sqlite.variants
      .getVariants({ ...filter, case_id: sqliteCase }, 50, 0)
      .data.map((v) => v.pos)
      .sort()
    const pg = (
      await new PostgresVariantReadRepository(pool, schema).queryVariants(
        { ...filter, case_id: pgCase },
        50,
        0
      )
    ).data
      .map((v) => Number(v.pos))
      .sort()
    expect(pg, 'PostgreSQL = SQLite').toEqual(lite)
    return pg
  }

  it.each(['de_novo', 'autosomal_recessive', 'compound_het'])(
    '%s without an analysis group matches no row (#553)',
    async (mode) => {
      expect(await matching({ inheritance_modes: [mode] })).toEqual([])
    }
  )

  it('a solo mode mixed with a trio mode keeps only the solo rows (#553)', async () => {
    expect(await matching({ inheritance_modes: ['homozygous', 'de_novo'] })).toEqual([500])
  })

  it('candidate compound het counts only rows that pass the other filters (#579)', async () => {
    const mode = { inheritance_modes: ['candidate_compound_het'] }
    expect(await matching(mode)).toEqual([100, 200, 300, 400])
    expect(await matching({ ...mode, gnomad_af_max: 0.01 })).toEqual([300, 400])
  })
})
