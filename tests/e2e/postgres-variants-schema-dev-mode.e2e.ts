import { test, expect } from '@playwright/test'
import { setTimeout as delay } from 'node:timers/promises'
import { Pool, type QueryResult } from 'pg'

async function queryWithStartupRetry<T>(
  pool: Pool,
  sql: string,
  params: unknown[] = []
): Promise<QueryResult<T>> {
  let lastError: unknown

  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      return await pool.query<T>(sql, params)
    } catch (error) {
      lastError = error
      await delay(500)
    }
  }

  throw lastError
}

test('postgres dev schema exposes phase 7 variant read tables and seed data', async () => {
  test.skip(
    process.env.VARLENS_RUN_POSTGRES_E2E !== '1',
    'Set VARLENS_RUN_POSTGRES_E2E=1 after starting the local postgres container to run this test.'
  )

  const pool = new Pool({
    connectionString:
      process.env.VARLENS_PG_URL ??
      'postgres://varlens:varlens_dev_password@127.0.0.1:55432/varlens_dev'
  })

  try {
    const tables = await queryWithStartupRetry<{ table_name: string }>(
      pool,
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = $1
         AND table_name = ANY($2::text[])
       ORDER BY table_name`,
      [
        process.env.VARLENS_PG_SCHEMA ?? 'public',
        ['variants', 'variant_sv', 'variant_cnv', 'variant_str']
      ]
    )
    expect(tables.rows.map((row) => row.table_name)).toEqual([
      'variant_cnv',
      'variant_str',
      'variant_sv',
      'variants'
    ])

    const seeded = await pool.query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM variants WHERE case_id = $1',
      [1]
    )
    expect(seeded.rows[0]?.count).toBe(5)

    const baseSearch = await pool.query<{ id: number }>(
      "SELECT id::int AS id FROM variants WHERE search_document @@ to_tsquery('simple', 'brca1:*') ORDER BY id"
    )
    expect(baseSearch.rows.map((row) => row.id)).toContain(1)

    const strSearch = await pool.query<{ variant_id: number }>(
      "SELECT variant_id::int AS variant_id FROM variant_str WHERE search_document @@ to_tsquery('simple', 'huntington:*')"
    )
    expect(strSearch.rows.map((row) => row.variant_id)).toContain(5)

    const simpleConfig = await pool.query<{ simple: string; english: string }>(
      "SELECT to_tsvector('simple', 'RUNS')::text AS simple, to_tsvector('english', 'RUNS')::text AS english"
    )
    expect(simpleConfig.rows[0]?.simple).not.toBe(simpleConfig.rows[0]?.english)
  } finally {
    await pool.end()
  }
})
