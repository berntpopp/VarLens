/**
 * Cohort keyset paging on PostgreSQL (summary path, default carrier-count sort)
 * and migration 0021.
 *
 * The static block locks 0021's index columns to cohortKeysetTerms('', 'postgres').
 * The live block (VARLENS_RUN_POSTGRES_E2E=1) checks that cursor-chained pages
 * equal OFFSET pages and the pre-keyset order, including carrier-count ties,
 * that stale cursors fall back to OFFSET, and that the seek is index-served.
 */
import { randomBytes } from 'node:crypto'

import { Client, Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { POSTGRES_MIGRATIONS } from '../../../src/main/storage/postgres/migrations/definitions'
import { PostgresMigrationRunner } from '../../../src/main/storage/postgres/migrations/PostgresMigrationRunner'
import { PostgresCohortRepository } from '../../../src/main/storage/postgres/PostgresCohortRepository'
import { PostgresCohortSummaryRepository } from '../../../src/main/storage/postgres/PostgresCohortSummaryRepository'
import { cohortOrderByClause } from '../../../src/shared/sql/chromosome-order'
import {
  COHORT_KEYSET_INDEX,
  cohortKeysetOrderByClause,
  cohortKeysetPredicate,
  cohortKeysetTerms
} from '../../../src/shared/sql/cohort-keyset'
import type { CohortSearchParams, CohortVariant } from '../../../src/shared/types/cohort'

const RUN = process.env.VARLENS_RUN_POSTGRES_E2E === '1'
const PG_URL =
  process.env.VARLENS_PG_URL ??
  'postgres://varlens:varlens_dev_password@127.0.0.1:55432/varlens_dev'

const CONTIGS = ['10', 'X', '2', 'MT', '1', 'GL000220.1', '22']

describe('PG migration 0021 — cohort_keyset_index (static)', () => {
  const migration = POSTGRES_MIGRATIONS.find((m) => m.version === '0021')

  it('is registered after 0019', () => {
    expect(migration?.name).toBe('cohort_keyset_index')
    const versions = POSTGRES_MIGRATIONS.map((m) => m.version)
    expect(versions.indexOf('0021')).toBe(versions.indexOf('0020') + 1)
  })

  it('indexes exactly the shared keyset terms and drops the superseded index', () => {
    const sql = (migration?.sql ?? '').replace(/\s+/g, ' ')
    expect(sql).toContain(`CREATE INDEX IF NOT EXISTS ${COHORT_KEYSET_INDEX}`)
    expect(sql).toContain(`( ${cohortKeysetTerms('', 'postgres').join(', ')} )`)
    expect(sql).toContain('DROP INDEX IF EXISTS "__schema__".idx_cvs_carrier_chr_rank')
  })
})

describe.skipIf(!RUN)('cohort keyset paging — PostgreSQL', () => {
  let schema: string
  let pool: Pool

  async function seedCase(index: number): Promise<void> {
    const caseRow = await pool.query<{ id: number }>(
      `INSERT INTO "${schema}".cases (name, file_path, file_size, created_at, genome_build)
         VALUES ($1, '/tmp/x.json', 0, $2, 'GRCh38') RETURNING id`,
      [`keyset-${index}`, Date.now()]
    )
    const id = caseRow.rows[0].id
    for (let i = 0; i < 60; i++) {
      if (i % index !== 0) continue
      await pool.query(
        `INSERT INTO "${schema}".variants (case_id, chr, pos, ref, alt, variant_type, gene_symbol, gt_num)
           VALUES ($1, $2, $3, 'A', $4, 'snv', 'GENE', '0/1')`,
        [id, CONTIGS[i % CONTIGS.length], 1000 + (i % 9) * 10, i % 2 ? 'G' : 'T']
      )
    }
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await new PostgresCohortSummaryRepository().incrementalAdd({
        schema,
        client: client as never,
        caseId: id
      })
      await client.query('COMMIT')
    } finally {
      client.release()
    }
  }

  beforeAll(async () => {
    schema = `vt_cohort_keyset_${randomBytes(4).toString('hex')}`
    const provisioner = new Client({ connectionString: PG_URL })
    await provisioner.connect()
    await provisioner.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`)
    await provisioner.end()
    pool = new Pool({ connectionString: PG_URL, max: 2 })
    await new PostgresMigrationRunner(pool, schema, POSTGRES_MIGRATIONS).migrate()
    for (let c = 1; c <= 5; c++) await seedCase(c)
  }, 120_000)

  afterAll(async () => {
    if (pool) await pool.end()
    const cleaner = new Client({ connectionString: PG_URL })
    await cleaner.connect()
    await cleaner.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    await cleaner.end()
  }, 120_000)

  const key = (v: CohortVariant): string =>
    `${v.chr}:${v.pos}:${v.ref}>${v.alt}#${Number(v.carrier_count)}`

  async function referenceOrder(params: CohortSearchParams = {}): Promise<string[]> {
    const min = params.carrier_count_min
    const res = await pool.query(
      `SELECT chr, pos, ref, alt, carrier_count FROM "${schema}".cohort_variant_summary cvs
       ${min !== undefined ? 'WHERE carrier_count >= $1' : ''}
       ${cohortOrderByClause('carrier_count', 'cvs.carrier_count', 'desc', 'cvs', 'postgres')}`,
      min !== undefined ? [min] : []
    )
    return (res.rows as CohortVariant[]).map(key)
  }

  async function pageAll(limit: number, params: CohortSearchParams = {}): Promise<string[]> {
    const repo = new PostgresCohortRepository(pool, schema)
    const out: string[] = []
    let cursor: string | undefined
    for (let page = 0; page < 100; page++) {
      const result = await repo.queryVariants({ ...params, limit, offset: page * limit, cursor })
      if (cursor !== undefined) expect(result.paging).toBe('keyset')
      out.push(...result.data.map(key))
      if (result.data.length < limit) break
      cursor = result.next_cursor
      expect(cursor).toBeTypeOf('string')
    }
    return out
  }

  it('cursor-chained pages equal the pre-keyset order (with ties)', async () => {
    const expected = await referenceOrder()
    expect(expected.length).toBeGreaterThan(40)
    for (const limit of [1, 7, 50]) expect(await pageAll(limit)).toEqual(expected)
  })

  it('OFFSET pages without a cursor return the same order', async () => {
    const repo = new PostgresCohortRepository(pool, schema)
    const expected = await referenceOrder()
    const pages: string[] = []
    for (let offset = 0; offset < expected.length; offset += 9) {
      pages.push(...(await repo.queryVariants({ limit: 9, offset })).data.map(key))
    }
    expect(pages).toEqual(expected)
  })

  it('combines with filters and ignores a cursor from another filter set', async () => {
    expect(await pageAll(4, { carrier_count_min: 2 })).toEqual(
      await referenceOrder({ carrier_count_min: 2 })
    )
    const repo = new PostgresCohortRepository(pool, schema)
    const first = await repo.queryVariants({ limit: 5, offset: 0 })
    const other = await repo.queryVariants({
      limit: 5,
      offset: 5,
      carrier_count_min: 2,
      cursor: first.next_cursor
    })
    expect(other.paging).toBeUndefined()
    expect(other.data.map(key)).toEqual(
      (await referenceOrder({ carrier_count_min: 2 })).slice(5, 10)
    )
  })

  it('the seek and order are served by idx_cvs_carrier_keyset without a sort', async () => {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('SET LOCAL enable_seqscan = off')
      await client.query('SET LOCAL enable_sort = off')
      const predicate = cohortKeysetPredicate('cvs', 'postgres', [
        '$1::bigint',
        '$2::text',
        '$3::bigint',
        '$4::text',
        '$5::text',
        '$6::text',
        '$7::text'
      ])
      const res = await client.query<{ 'QUERY PLAN': string }>(
        `EXPLAIN SELECT cvs.chr FROM "${schema}"."cohort_variant_summary" cvs
           WHERE cvs.genome_build = 'GRCh38' AND ${predicate}
           ${cohortKeysetOrderByClause('cvs', 'postgres')} LIMIT 50`,
        [3, '2', 1000, 'A', 'G', 'snv', 'GRCh38']
      )
      await client.query('ROLLBACK')
      const plan = res.rows.map((r) => r['QUERY PLAN']).join('\n')
      expect(plan).toContain(COHORT_KEYSET_INDEX)
      expect(plan).toContain('Index Cond')
      expect(plan).not.toMatch(/\bSort\b/)
    } finally {
      client.release()
    }
  })
})
