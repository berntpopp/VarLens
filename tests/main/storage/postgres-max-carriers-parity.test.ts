/**
 * Carrier cap (#455) against a real PostgreSQL: in a single-build database
 * with a fresh cohort summary, the case view and the cohort view return the
 * same variants for the same K, including page counts and the cohort export.
 *
 * The two views read different tables (variant_frequency / the summary), so
 * this file makes no claim about a stale summary or a mixed-build database.
 *
 * Gated by VARLENS_RUN_POSTGRES_E2E=1. Requires `make pg-up`.
 */
import { randomBytes } from 'node:crypto'

import { Client, Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { POSTGRES_MIGRATIONS } from '../../../src/main/storage/postgres/migrations/definitions'
import { PostgresMigrationRunner } from '../../../src/main/storage/postgres/migrations/PostgresMigrationRunner'
import { PostgresCohortRepository } from '../../../src/main/storage/postgres/PostgresCohortRepository'
import { PostgresCohortSummaryRepository } from '../../../src/main/storage/postgres/PostgresCohortSummaryRepository'
import { PostgresVariantReadRepository } from '../../../src/main/storage/postgres/PostgresVariantReadRepository'

const RUN = process.env.VARLENS_RUN_POSTGRES_E2E === '1'
const PG_URL =
  process.env.VARLENS_PG_URL ??
  'postgres://varlens:varlens_dev_password@127.0.0.1:55432/varlens_dev'

interface Coord {
  chr: string
  pos: number
  ref: string
  alt: string
}
const SHARED: Coord = { chr: '1', pos: 100, ref: 'A', alt: 'G' }
const UNIQUE: Coord = { chr: '1', pos: 200, ref: 'C', alt: 'T' }
/** SHARED is in all three cases, UNIQUE in the first. All cases are GRCh38. */
const CASES: Coord[][] = [[SHARED, UNIQUE], [SHARED], [SHARED]]

const coordKey = (v: { chr: unknown; pos: unknown; ref: unknown; alt: unknown }): string =>
  `${String(v.chr)}:${Number(v.pos)}:${String(v.ref)}:${String(v.alt)}`

describe.skipIf(!RUN)('carrier cap (#455): PostgreSQL case view and cohort view', () => {
  let schema: string
  let pool: Pool
  const caseIds: number[] = []

  beforeAll(async () => {
    schema = `vt_max_carriers_${randomBytes(4).toString('hex')}`
    const provisioner = new Client({ connectionString: PG_URL })
    await provisioner.connect()
    await provisioner.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`)
    await provisioner.end()

    pool = new Pool({ connectionString: PG_URL, max: 3 })
    await new PostgresMigrationRunner(pool, schema, POSTGRES_MIGRATIONS).migrate()

    const summaryRepo = new PostgresCohortSummaryRepository()
    for (const [index, variants] of CASES.entries()) {
      const created = await pool.query<{ id: string }>(
        `INSERT INTO "${schema}".cases (name, file_path, file_size, created_at, genome_build, import_status)
         VALUES ($1, $2, 0, $3, 'GRCh38', 'ready') RETURNING id`,
        [`cap-${index}`, `/tmp/cap-${index}.json`, Date.now()]
      )
      const caseId = Number(created.rows[0].id)
      caseIds.push(caseId)
      for (const v of variants) {
        await pool.query(
          `INSERT INTO "${schema}".variants (case_id, chr, pos, ref, alt, variant_type, gt_num)
           VALUES ($1, $2, $3, $4, $5, 'snv', '0/1')`,
          [caseId, v.chr, v.pos, v.ref, v.alt]
        )
      }
      // Fresh summary: every case is added to it in its own transaction.
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        await summaryRepo.incrementalAdd({
          schema,
          client: client as never,
          caseId,
          genomeBuild: 'GRCh38'
        })
        await client.query('COMMIT')
      } finally {
        client.release()
      }
    }
    await pool.query(
      `INSERT INTO "${schema}".variant_frequency (chr, pos, ref, alt, case_count)
       SELECT chr, pos, ref, alt, COUNT(DISTINCT case_id) FROM "${schema}".variants
       GROUP BY chr, pos, ref, alt`
    )
  }, 180_000)

  afterAll(async () => {
    if (pool) await pool.end()
    if (schema !== undefined) {
      const cleaner = new Client({ connectionString: PG_URL })
      await cleaner.connect()
      await cleaner.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
      await cleaner.end()
    }
  }, 120_000)

  it.each([
    [1, ['1:200:C:T']],
    [2, ['1:200:C:T']],
    [3, ['1:100:A:G', '1:200:C:T']],
    // API callers may send any positive safe integer, beyond PostgreSQL int4.
    [3_000_000_000, ['1:100:A:G', '1:200:C:T']],
    [Number.MAX_SAFE_INTEGER, ['1:100:A:G', '1:200:C:T']],
    [undefined, ['1:100:A:G', '1:200:C:T']]
  ] as const)(
    'K = %s: both views, their counts and the export agree',
    async (max, expected) => {
      const variants = new PostgresVariantReadRepository(pool, schema)
      const cohort = new PostgresCohortRepository(pool, schema)

      const fromCases = new Set<string>()
      let caseTotal = 0
      for (const caseId of caseIds) {
        const page = await variants.queryVariants(
          { case_id: caseId, carrier_count_max: max },
          50,
          0
        )
        expect(page.total_count).toBe(page.data.length)
        caseTotal += page.total_count
        for (const v of page.data) fromCases.add(coordKey(v))
      }
      // SHARED is one row in each of the three cases when it is kept.
      expect(caseTotal).toBe(expected.includes('1:100:A:G') ? 4 : 1)

      const page = await cohort.queryVariants({ genome_build: 'GRCh38', carrier_count_max: max })
      const exported: string[] = []
      for await (const row of cohort.streamCohortRows({
        genome_build: 'GRCh38',
        carrier_count_max: max
      })) {
        exported.push(coordKey(row as never))
      }

      expect([...fromCases].sort()).toEqual([...expected])
      expect(page.data.map(coordKey).sort()).toEqual([...expected])
      expect(page.total_count).toBe(expected.length)
      expect(exported.sort()).toEqual([...expected])
    },
    120_000
  )
})
