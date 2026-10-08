/**
 * Cohort row identity on PostgreSQL (#503): one coordinate in two genome
 * builds, or stored as two variant types, is two summary rows, each with its
 * own key and its own carriers. SQLite twin: the "row identity" block of
 * tests/main/database/cohort.test.ts (same seed).
 *
 * Gated by VARLENS_RUN_POSTGRES_E2E=1 (requires `make pg-up`), like the other
 * real-Postgres tests.
 */
import { randomBytes } from 'node:crypto'

import { Client, Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { POSTGRES_MIGRATIONS } from '../../../src/main/storage/postgres/migrations/definitions'
import { PostgresMigrationRunner } from '../../../src/main/storage/postgres/migrations/PostgresMigrationRunner'
import { PostgresCohortRepository } from '../../../src/main/storage/postgres/PostgresCohortRepository'
import { PostgresCohortSummaryRepository } from '../../../src/main/storage/postgres/PostgresCohortSummaryRepository'
import type { CohortVariant } from '../../../src/shared/types/cohort'
import { cohortVariantKey } from '../../../src/shared/utils/cohort-variant-key'

const RUN = process.env.VARLENS_RUN_POSTGRES_E2E === '1'
const PG_URL =
  process.env.VARLENS_PG_URL ??
  'postgres://varlens:varlens_dev_password@127.0.0.1:55432/varlens_dev'

// One case per line: name, build, chr, pos, ref, alt, variant type.
const SEEDS: Array<[string, string, string, number, string, string, string]> = [
  ['b38-a', 'GRCh38', '1', 100, 'A', 'T', 'snv'],
  ['b38-b', 'GRCh38', '1', 100, 'A', 'T', 'snv'],
  ['b37-a', 'GRCh37', '1', 100, 'A', 'T', 'snv'],
  ['sv-a', 'GRCh38', '7', 1000, 'N', '<DEL>', 'sv'],
  ['cnv-a', 'GRCh38', '7', 1000, 'N', '<DEL>', 'cnv'],
  ['cnv-b', 'GRCh38', '7', 1000, 'N', '<DEL>', 'cnv'],
  ['bnd-a', 'GRCh38', '2', 321681, 'G', ']13:123456]T', 'sv'],
  ['indel-a', 'GRCh38', '3', 500, 'AT', 'A', 'indel']
]

describe.skipIf(!RUN)('cohort row identity on PostgreSQL (#503)', () => {
  let schema: string
  let pool: Pool
  let repo: PostgresCohortRepository

  const rows = async (params: Record<string, unknown> = {}): Promise<CohortVariant[]> =>
    (await repo.queryVariants({ limit: 100, offset: 0, ...params })).data
  const at = async (pos: number): Promise<CohortVariant[]> =>
    (await rows()).filter((row) => row.pos === pos)

  beforeAll(async () => {
    schema = `vt_row_identity_${randomBytes(4).toString('hex')}`
    const provisioner = new Client({ connectionString: PG_URL })
    await provisioner.connect()
    await provisioner.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`)
    await provisioner.end()
    pool = new Pool({ connectionString: PG_URL, max: 2 })
    await new PostgresMigrationRunner(pool, schema, POSTGRES_MIGRATIONS).migrate()
    repo = new PostgresCohortRepository(pool, schema)

    for (const [name, build, chr, pos, ref, alt, type] of SEEDS) {
      const inserted = await pool.query<{ id: number }>(
        `INSERT INTO "${schema}".cases (name, file_path, file_size, created_at, genome_build)
           VALUES ($1, $2, 0, $3, $4) RETURNING id`,
        [name, `/tmp/${name}.vcf`, Date.now(), build]
      )
      const caseId = inserted.rows[0].id
      await pool.query(
        `INSERT INTO "${schema}".variants (case_id, chr, pos, ref, alt, variant_type, gt_num)
           VALUES ($1, $2, $3, $4, $5, $6, '0/1')`,
        [caseId, chr, pos, ref, alt, type]
      )
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        await new PostgresCohortSummaryRepository().incrementalAdd({
          schema,
          client: client as never,
          caseId
        })
        await client.query('COMMIT')
      } finally {
        client.release()
      }
    }
  }, 120_000)

  afterAll(async () => {
    if (pool) await pool.end()
    const cleaner = new Client({ connectionString: PG_URL })
    await cleaner.connect()
    await cleaner.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    await cleaner.end()
  }, 120_000)

  it('gives one coordinate in two builds two rows with their own key', async () => {
    const pair = await at(100)
    expect(new Set(pair.map((row) => row.variant_key)).size).toBe(2)
  })

  it('gives one coordinate stored as sv and as cnv two rows with their own key', async () => {
    const pair = await at(1000)
    expect(pair.map((row) => row.variant_type).sort()).toEqual(['cnv', 'sv'])
    expect(new Set(pair.map((row) => row.variant_key)).size).toBe(2)
  })

  it('builds every key from the six fields, so no two rows share one', async () => {
    const all = await rows()
    expect(all).toHaveLength(6)
    for (const row of all) expect(row.variant_key).toBe(cohortVariantKey(row))
    expect(new Set(all.map((row) => row.variant_key)).size).toBe(all.length)
    expect((await at(321681)).map((row) => row.alt)).toEqual([']13:123456]T'])
  })

  const carriersOf = async (row: CohortVariant): Promise<string[]> =>
    (await repo.getCarriers(row)).map((carrier) => carrier.case_name)

  it('lists the carriers of each build of one coordinate separately', async () => {
    const byBuild: Record<string, string[]> = {}
    for (const row of await at(100)) byBuild[row.genome_build] = await carriersOf(row)
    expect(byBuild).toEqual({ GRCh38: ['b38-a', 'b38-b'], GRCh37: ['b37-a'] })
  })

  it('lists the carriers of the sv row and of the cnv row separately', async () => {
    const byType: Record<string, string[]> = {}
    for (const row of await at(1000)) byType[row.variant_type] = await carriersOf(row)
    expect(byType).toEqual({ sv: ['sv-a'], cnv: ['cnv-a', 'cnv-b'] })
  })

  it('returns as many carriers as the row counts, for every row', async () => {
    for (const row of await rows()) expect(await carriersOf(row)).toHaveLength(row.carrier_count)
  })

  it('finds the carriers of an indel row listed under the snv filter', async () => {
    const [indel] = (await rows({ variant_type: 'snv' })).filter((row) => row.pos === 500)
    expect(indel.variant_type).toBe('indel')
    expect(await carriersOf(indel)).toEqual(['indel-a'])
  })

})
describe.skipIf(RUN)('cohort row identity on PostgreSQL (skipped)', () => {
  it('runs only when VARLENS_RUN_POSTGRES_E2E=1 and `make pg-up` is up', () => {
    expect(RUN).toBe(false)
  })
})
