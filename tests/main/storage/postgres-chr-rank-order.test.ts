/**
 * Natural chromosome order on PostgreSQL (web): migration 0017 + case and
 * cohort read paths.
 *
 * The static block always runs and locks 0017's index expression to the
 * shared chrRankSql('chr'). If they drift, ORDER BY no longer matches the
 * indexes and every page falls back to a full sort.
 *
 * The live block is gated by VARLENS_RUN_POSTGRES_E2E=1 (requires `make pg-up`),
 * like the other real-Postgres tests.
 */
import { randomBytes } from 'node:crypto'

import { Client, Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { POSTGRES_MIGRATIONS } from '../../../src/main/storage/postgres/migrations/definitions'
import { PostgresMigrationRunner } from '../../../src/main/storage/postgres/migrations/PostgresMigrationRunner'
import { PostgresCohortRepository } from '../../../src/main/storage/postgres/PostgresCohortRepository'
import { PostgresCohortSummaryRepository } from '../../../src/main/storage/postgres/PostgresCohortSummaryRepository'
import { PostgresVariantReadRepository } from '../../../src/main/storage/postgres/PostgresVariantReadRepository'
import {
  chromosomeRank,
  chrRankSql,
  cohortOrderByClause,
  genomicVariantOrderTerms
} from '../../../src/shared/sql/chromosome-order'
import { cohortKeysetOrderByClause } from '../../../src/shared/sql/cohort-keyset'

const RUN = process.env.VARLENS_RUN_POSTGRES_E2E === '1'
const PG_URL =
  process.env.VARLENS_PG_URL ??
  'postgres://varlens:varlens_dev_password@127.0.0.1:55432/varlens_dev'

const CONTIGS = ['10', 'MT', 'GL000220.1', '2', 'Y', '1', 'chrUn_KI270742v1', 'X', '22', '11']
const NATURAL = ['1', '2', '10', '11', '22', 'X', 'Y', 'MT', 'GL000220.1', 'chrUn_KI270742v1']
const SHARED = ['10', 'MT', 'GL000220.1']

const coords = (rows: Array<{ chr: unknown; pos: unknown }>): string[] =>
  rows.map((r) => `${String(r.chr)}:${String(r.pos)}`)
const naturalCoords = (chromosomes: string[]): string[] =>
  chromosomes.flatMap((chr) => [`${chr}:1000`, `${chr}:2000`])

describe('PG migration 0017 — chr_rank_indexes (static)', () => {
  const migration = POSTGRES_MIGRATIONS.find((m) => m.version === '0017')

  it('is registered after 0016', () => {
    expect(migration?.name).toBe('chr_rank_indexes')
    const versions = POSTGRES_MIGRATIONS.map((m) => m.version)
    expect(versions.indexOf('0017')).toBe(versions.indexOf('0016') + 1)
  })

  it('builds all three indexes on the exact shared chr-rank expression', () => {
    const sql = migration?.sql ?? ''
    expect(sql.split(chrRankSql('chr')).length - 1).toBe(3)
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_variants_case_chr_rank')
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_cvs_chr_rank')
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_cvs_carrier_chr_rank')
    expect(sql).toContain('carrier_count DESC NULLS LAST')
    // bytewise name tiebreaker, matching the PG sinks' `chr COLLATE "C"`
    expect(sql.split('chr COLLATE "C"').length - 1).toBe(3)
  })
})

describe.skipIf(!RUN)('natural chromosome order — PostgreSQL', () => {
  let schema: string
  let pool: Pool
  let caseId: number

  async function seedCase(name: string, gt: string, contigs: string[]): Promise<number> {
    const caseRow = await pool.query<{ id: number }>(
      `INSERT INTO "${schema}".cases (name, file_path, file_size, created_at, genome_build)
         VALUES ($1, $2, 0, $3, 'GRCh38') RETURNING id`,
      [name, `/tmp/${name}.json`, Date.now()]
    )
    const id = caseRow.rows[0].id
    for (const chr of contigs) {
      for (const pos of [2000, 1000]) {
        await pool.query(
          `INSERT INTO "${schema}".variants (case_id, chr, pos, ref, alt, variant_type, gene_symbol, gt_num)
             VALUES ($1, $2, $3, 'A', 'T', 'snv', $4, $5)`,
          [id, chr, pos, `G${chr}`, gt]
        )
      }
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
    return id
  }

  /** EXPLAIN with seq scans and explicit sorts disabled: proves the index can serve ORDER BY. */
  async function planFor(sql: string, values: unknown[]): Promise<string> {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('SET LOCAL enable_seqscan = off')
      await client.query('SET LOCAL enable_sort = off')
      const res = await client.query<{ 'QUERY PLAN': string }>(`EXPLAIN ${sql}`, values)
      await client.query('ROLLBACK')
      return res.rows.map((r) => r['QUERY PLAN']).join('\n')
    } finally {
      client.release()
    }
  }

  beforeAll(async () => {
    schema = `vt_chr_rank_${randomBytes(4).toString('hex')}`
    const provisioner = new Client({ connectionString: PG_URL })
    await provisioner.connect()
    await provisioner.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`)
    await provisioner.end()
    pool = new Pool({ connectionString: PG_URL, max: 2 })
    await new PostgresMigrationRunner(pool, schema, POSTGRES_MIGRATIONS).migrate()
    caseId = await seedCase('chr-order-a', '0/1', CONTIGS)
    await seedCase('chr-order-b', '1/1', SHARED)
  }, 120_000)

  afterAll(async () => {
    if (pool) await pool.end()
    const cleaner = new Client({ connectionString: PG_URL })
    await cleaner.connect()
    await cleaner.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    await cleaner.end()
  }, 120_000)

  it('evaluates chrRankSql identically to the SQLite/JS mapping', async () => {
    const contigs = [...CONTIGS, 'chrX', 'chrx', 'chrM', 'chrMT', 'Chr2', 'CHR22', 'chr', '23', '']
    const res = await pool.query<{ chr: string; rank: number }>(
      `SELECT chr, ${chrRankSql('chr')} AS rank FROM unnest($1::text[]) AS t(chr)`,
      [contigs]
    )
    expect(res.rows).toHaveLength(contigs.length)
    for (const row of res.rows) expect(row.rank, row.chr).toBe(chromosomeRank(row.chr))
  })

  it('case view: default and chr sorts use natural order', async () => {
    const repo = new PostgresVariantReadRepository(pool, schema)
    const byDefault = await repo.queryVariants({ case_id: caseId }, 100, 0)
    expect(coords(byDefault.data)).toEqual(naturalCoords(NATURAL))

    const asc = await repo.queryVariants({ case_id: caseId }, 100, 0, [
      { key: 'chr', order: 'asc' }
    ])
    expect(coords(asc.data)).toEqual(naturalCoords(NATURAL))

    const desc = await repo.queryVariants({ case_id: caseId }, 100, 0, [
      { key: 'chr', order: 'desc' }
    ])
    expect([...new Set(desc.data.map((v) => v.chr))]).toEqual([...NATURAL].reverse())
  })

  it('cohort view (summary path): tiebreaker and chr sort use natural order', async () => {
    const repo = new PostgresCohortRepository(pool, schema)
    const byDefault = (await repo.queryVariants({ limit: 100, offset: 0 })).data
    expect(coords(byDefault.slice(0, 6))).toEqual(naturalCoords(SHARED))
    expect(coords(byDefault.slice(6))).toEqual(
      naturalCoords(NATURAL.filter((c) => !SHARED.includes(c)))
    )

    const asc = (
      await repo.queryVariants({ limit: 100, offset: 0, sort_by: 'chr', sort_order: 'asc' })
    ).data
    expect(coords(asc)).toEqual(naturalCoords(NATURAL))
  })

  it('cohort view (live aggregate path, used by export): natural order', async () => {
    const repo = new PostgresCohortRepository(pool, schema)
    const collect = async (params: Parameters<typeof repo.streamCohortRows>[0]) => {
      const rows: Array<Record<string, unknown>> = []
      for await (const row of repo.streamCohortRows(params)) rows.push(row)
      return rows as Array<{ chr: unknown; pos: unknown }>
    }
    const asc = await collect({ sort_by: 'chr', sort_order: 'asc' })
    expect(coords(asc)).toEqual(naturalCoords(NATURAL))

    const byDefault = await collect({})
    expect(coords(byDefault.slice(0, 6))).toEqual(naturalCoords(SHARED))
    expect(coords(byDefault.slice(6))).toEqual(
      naturalCoords(NATURAL.filter((c) => !SHARED.includes(c)))
    )
  })

  it('idx_variants_case_chr_rank serves the default case order', async () => {
    const order = [...genomicVariantOrderTerms('v', 'postgres'), 'v.id ASC'].join(', ')
    const plan = await planFor(
      `SELECT v.id FROM "${schema}"."variants" v WHERE v.case_id = $1 ORDER BY ${order} LIMIT 50`,
      [caseId]
    )
    expect(plan).toContain('idx_variants_case_chr_rank')
    expect(plan).not.toMatch(/\bSort\b/)
  })

  it('cohort indexes serve the default and chr-sorted summary orders', async () => {
    // Default order is the keyset order since 0020 (idx_cvs_carrier_keyset).
    const byCarrier = await planFor(
      `SELECT cvs.chr FROM "${schema}"."cohort_variant_summary" cvs
         ${cohortKeysetOrderByClause('cvs', 'postgres')} LIMIT 50`,
      []
    )
    expect(byCarrier).toContain('idx_cvs_carrier_keyset')
    expect(byCarrier).not.toMatch(/\bSort\b/)

    const byChr = await planFor(
      `SELECT cvs.chr FROM "${schema}"."cohort_variant_summary" cvs
         ${cohortOrderByClause('chr', 'cvs.chr', 'asc', 'cvs', 'postgres')} LIMIT 50`,
      []
    )
    expect(byChr).toContain('idx_cvs_chr_rank')
    expect(byChr).not.toMatch(/\bSort\b/)
  })
})
