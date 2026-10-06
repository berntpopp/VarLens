/**
 * Keyset paging must return exactly the rows OFFSET paging returns, page for
 * page, including ties on (chr, pos) — against a real Postgres.
 *
 * Gated by VARLENS_RUN_POSTGRES_E2E=1. Requires `make pg-up`.
 */
import { randomBytes } from 'node:crypto'

import { Client, Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { POSTGRES_MIGRATIONS } from '../../../src/main/storage/postgres/migrations/definitions'
import { PostgresMigrationRunner } from '../../../src/main/storage/postgres/migrations/PostgresMigrationRunner'
import { PostgresVariantReadRepository } from '../../../src/main/storage/postgres/PostgresVariantReadRepository'
import type { SortItem, VariantFilter } from '../../../src/shared/types/database'

const RUN = process.env.VARLENS_RUN_POSTGRES_E2E === '1'
const PG_URL =
  process.env.VARLENS_PG_URL ??
  'postgres://varlens:varlens_dev_password@127.0.0.1:55432/varlens_dev'

describe.skipIf(!RUN)('Postgres variant keyset paging', () => {
  let schema: string
  let pool: Pool
  let caseId: number

  beforeAll(async () => {
    schema = `varlens_test_keyset_${Date.now()}_${randomBytes(4).toString('hex')}`
    const admin = new Client({ connectionString: PG_URL })
    await admin.connect()
    await admin.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`)
    await admin.end()
    pool = new Pool({ connectionString: PG_URL, max: 2 })
    await new PostgresMigrationRunner(pool, schema, POSTGRES_MIGRATIONS).migrate()

    const res = await pool.query<{ id: string }>(
      `INSERT INTO "${schema}".cases (name, file_path, file_size, created_at)
         VALUES ('keyset', '/tmp/k.vcf', 0, 0) RETURNING id`
    )
    caseId = Number(res.rows[0].id)
    // 4 chromosomes × 60 positions, every 5th position duplicated (ties).
    await pool.query(
      `INSERT INTO "${schema}".variants
         (case_id, chr, pos, ref, alt, variant_type, consequence, gene_symbol)
       SELECT $1, chr, pos, 'A', alt, 'snv',
              CASE WHEN pos % 3 = 0 THEN 'HIGH' ELSE 'LOW' END,
              CASE WHEN pos % 4 = 0 THEN NULL ELSE 'G' || pos END
         FROM unnest(ARRAY['1', '10', '2', 'X']) chr,
              generate_series(1, 60) pos,
              LATERAL (SELECT 'T' AS alt UNION ALL SELECT 'C' WHERE pos % 5 = 0) alts`,
      [caseId]
    )
  }, 60_000)

  afterAll(async () => {
    if (pool) await pool.end()
    const cleaner = new Client({ connectionString: PG_URL })
    await cleaner.connect()
    await cleaner.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    await cleaner.end()
  }, 60_000)

  async function pageIds(
    filter: VariantFilter,
    sortBy: SortItem[] | undefined,
    limit: number,
    mode: 'offset' | 'keyset',
    expectSeek = mode === 'keyset'
  ): Promise<number[][]> {
    const repo = new PostgresVariantReadRepository(pool, schema)
    const pages: number[][] = []
    let cursor: string | undefined
    for (let offset = 0; ; offset += limit) {
      const result = await repo.queryVariants(
        filter,
        limit,
        offset,
        sortBy,
        true,
        false,
        mode === 'keyset' ? (cursor === undefined ? {} : { cursor }) : undefined
      )
      if (expectSeek && cursor !== undefined) expect(result.paging).toBe('keyset')
      if (result.data.length === 0) break
      pages.push(result.data.map((v) => Number(v.id)))
      cursor = result.next_cursor
      if (result.data.length < limit) break
      if (expectSeek) expect(cursor).toBeDefined()
    }
    return pages
  }

  it('default genomic order: keyset pages equal OFFSET pages', async () => {
    const filter = { case_id: caseId }
    const offsetPages = await pageIds(filter, undefined, 37, 'offset')
    const keysetPages = await pageIds(filter, undefined, 37, 'keyset')
    expect(keysetPages).toEqual(offsetPages)
    expect(offsetPages.flat()).toHaveLength(4 * 72)
  })

  it('explicit ascending pos sort with a filter: keyset pages equal OFFSET pages', async () => {
    const filter = { case_id: caseId, consequences: ['HIGH'] } as VariantFilter
    const sort: SortItem[] = [{ key: 'pos', order: 'asc' }]
    const offsetPages = await pageIds(filter, sort, 11, 'offset')
    const keysetPages = await pageIds(filter, sort, 11, 'keyset')
    expect(keysetPages).toEqual(offsetPages)
    expect(offsetPages.flat().length).toBeGreaterThan(11)
  })

  it('nullable sort column falls back to OFFSET with identical results', async () => {
    const sort: SortItem[] = [{ key: 'gene_symbol', order: 'asc' }]
    const repo = new PostgresVariantReadRepository(pool, schema)
    const first = await repo.queryVariants({ case_id: caseId }, 20, 0, sort, true, false, {})
    expect(first.next_cursor).toBeUndefined()
    const offsetPages = await pageIds({ case_id: caseId }, sort, 20, 'offset')
    const keysetPages = await pageIds({ case_id: caseId }, sort, 20, 'keyset', false)
    expect(keysetPages).toEqual(offsetPages)
  })
})
