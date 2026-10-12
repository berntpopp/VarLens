/**
 * #555 review item 5: the per-build x class carrier-frequency denominators
 * are computed once per summary version and inlined as literals, instead of
 * probing every case on every query.
 */
import { describe, expect, it, vi } from 'vitest'

import { carrierTotalsSql } from '../../../src/main/storage/postgres/postgres-carrier-totals'

function fakePool(versions: string[]) {
  const query = vi.fn(async (text: string) => {
    if (text.includes('cohort_summary_state')) return { rows: [{ version: versions[0] }] }
    return {
      rows: [
        { build: 'GRCh38', vclass: 'small', total: '7' },
        { build: "it's", vclass: 'sv', total: '2' }
      ]
    }
  })
  return {
    query,
    totalsQueries: () => query.mock.calls.filter(([t]) => t.includes('EXISTS')).length
  }
}

describe('carrierTotalsSql', () => {
  it('inlines the totals as literals and recomputes them only when the version moves', async () => {
    const versions = ['v1']
    const pool = fakePool(versions)
    const first = await carrierTotalsSql(pool as never, 'cache_test_a')
    expect(first).toContain("SELECT 'GRCh38' AS build, 'small' AS vclass, 7 AS total")
    expect(first).toContain("'it''s'") // quoted, never raw text
    expect(first).not.toContain('EXISTS')

    await carrierTotalsSql(pool as never, 'cache_test_a')
    expect(pool.totalsQueries()).toBe(1)

    versions[0] = 'v2'
    await carrierTotalsSql(pool as never, 'cache_test_a')
    expect(pool.totalsQueries()).toBe(2)
  })

  it('has a typed empty table when no case holds a call', async () => {
    const pool = {
      query: vi.fn(async (text: string) => ({
        rows: text.includes('cohort_summary_state') ? [{ version: 'x' }] : []
      }))
    }
    const body = await carrierTotalsSql(pool as never, 'cache_test_b')
    expect(body).toContain('WHERE 1 = 0')
    expect(body).toContain('CAST(NULL AS INTEGER) AS total')
  })
})

const RUN = process.env.VARLENS_RUN_POSTGRES_E2E === '1'
const PG_URL =
  process.env.VARLENS_PG_URL ??
  'postgres://varlens:varlens_dev_password@127.0.0.1:55432/varlens_dev'

describe.skipIf(!RUN)('cached carrier-frequency denominators on a real PostgreSQL', () => {
  it('follow a newly published case', async () => {
    const { Client, Pool } = await import('pg')
    const { POSTGRES_MIGRATIONS } =
      await import('../../../src/main/storage/postgres/migrations/definitions')
    const { PostgresMigrationRunner } =
      await import('../../../src/main/storage/postgres/migrations/PostgresMigrationRunner')
    const { PostgresCohortSummaryRepository } =
      await import('../../../src/main/storage/postgres/PostgresCohortSummaryRepository')
    const { PostgresVariantReadRepository } =
      await import('../../../src/main/storage/postgres/PostgresVariantReadRepository')
    const schema = `varlens_test_totals_${Date.now()}`
    const admin = new Client({ connectionString: PG_URL })
    await admin.connect()
    await admin.query(`CREATE SCHEMA "${schema}"`)
    const pool = new Pool({ connectionString: PG_URL, max: 2 })
    try {
      await new PostgresMigrationRunner(pool, schema, POSTGRES_MIGRATIONS).migrate()
      const addCase = async (name: string, pos: number): Promise<number> => {
        const id = Number(
          (
            await pool.query<{ id: string }>(
              `INSERT INTO "${schema}".cases (name, file_path, file_size, created_at, genome_build)
               VALUES ($1, '/x', 0, 0, 'GRCh38') RETURNING id`,
              [name]
            )
          ).rows[0].id
        )
        await pool.query(
          `INSERT INTO "${schema}".variants (case_id, chr, pos, ref, alt, variant_type, gt_num)
           VALUES ($1, '1', $2, 'A', 'G', 'snv', '0/1')`,
          [id, pos]
        )
        const client = await pool.connect()
        try {
          await client.query('BEGIN')
          await new PostgresCohortSummaryRepository().incrementalAdd({
            schema,
            client: client as never,
            caseId: id,
            genomeBuild: 'GRCh38'
          })
          await client.query('COMMIT')
        } finally {
          client.release()
        }
        return id
      }
      const first = await addCase('a', 100)
      const repo = new PostgresVariantReadRepository(pool, schema)
      const frequency = async (): Promise<unknown> =>
        (await repo.queryVariants({ case_id: first }, 10, 0)).data[0].internal_af
      expect(await frequency()).toBe(1)
      await addCase('b', 200) // a second case with small variants, not carrying pos 100
      expect(await frequency()).toBe(0.5)
    } finally {
      await pool.end()
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
      await admin.end()
    }
  }, 120_000)
})
