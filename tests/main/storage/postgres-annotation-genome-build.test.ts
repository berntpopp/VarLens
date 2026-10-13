/**
 * Migration 0035 against a real PostgreSQL (#577; mirrors SQLite v52,
 * tests/main/database/migration-v52-annotation-build.test.ts): global
 * annotations are keyed by genome build; shared rows are copied, not moved.
 *
 * Gated by VARLENS_RUN_POSTGRES_E2E=1. Requires `make pg-up`.
 */
import { randomBytes } from 'node:crypto'

import { Client, Pool } from 'pg'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { POSTGRES_MIGRATIONS } from '../../../src/main/storage/postgres/migrations/definitions'
import { PostgresMigrationRunner } from '../../../src/main/storage/postgres/migrations/PostgresMigrationRunner'
import { PostgresAnnotationsRepository } from '../../../src/main/storage/postgres/PostgresAnnotationsRepository'
import { PostgresBuildReviewRepository } from '../../../src/main/storage/postgres/PostgresBuildReviewRepository'

const RUN = process.env.VARLENS_RUN_POSTGRES_E2E === '1'
const PG_URL =
  process.env.VARLENS_PG_URL ??
  'postgres://varlens:varlens_dev_password@127.0.0.1:55432/varlens_dev'

describe.skipIf(!RUN)('migration 0035: global annotations keyed by genome build', () => {
  let schema: string
  let pool: Pool
  let probe: Client
  const t = (table: string): string => `"${schema}"."${table}"`

  beforeEach(async () => {
    schema = `varlens_test_annbuild_${Date.now()}_${randomBytes(4).toString('hex')}`
    pool = new Pool({ connectionString: PG_URL, max: 3 })
    probe = new Client({ connectionString: PG_URL })
    await probe.connect()
    await probe.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`)
    await new PostgresMigrationRunner(
      pool,
      schema,
      POSTGRES_MIGRATIONS.filter((m) => m.version < '0035')
    ).migrate()
  }, 120_000)

  afterEach(async () => {
    await probe.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    await probe.end()
    await pool.end()
  }, 60_000)

  async function addCase(name: string, build: string): Promise<number> {
    const r = await probe.query<{ id: string }>(
      `INSERT INTO ${t('cases_all')} (name, file_path, file_size, created_at, genome_build)
       VALUES ($1, $2, 0, 0, $3) RETURNING id`,
      [name, `/tmp/${name}.json`, build]
    )
    return Number(r.rows[0].id)
  }
  const addVariant = (caseId: number, pos: number): Promise<unknown> =>
    probe.query(
      `INSERT INTO ${t('variants_all')} (case_id, chr, pos, ref, alt)
       VALUES ($1, 'chrUn_x', $2, 'A', 'G')`,
      [caseId, pos]
    )
  const rowsAt = async (pos: number): Promise<unknown[]> =>
    (
      await probe.query(
        `SELECT genome_build, global_comment, starred, acmg_classification
           FROM ${t('variant_annotations')} WHERE pos = $1 ORDER BY genome_build`,
        [pos]
      )
    ).rows
  const copy = (genome_build: string) => ({
    genome_build,
    global_comment: 'note',
    starred: 1,
    acmg_classification: 'Pathogenic'
  })

  async function seed(): Promise<{ b37: number; b38: number }> {
    const b37 = await addCase('b37', 'GRCh37')
    const b38 = await addCase('b38', 'GRCh38')
    await addVariant(b37, 100)
    await addVariant(b38, 100)
    await addVariant(b37, 5)
    for (const pos of [100, 5, 7]) {
      await probe.query(
        `INSERT INTO ${t('variant_annotations')} (chr, pos, ref, alt, global_comment, starred,
           acmg_classification, created_at, updated_at)
         VALUES ('chrUn_x', $1, 'A', 'G', 'note', 1, 'Pathogenic', 10, 20)`,
        [pos]
      )
    }
    await new PostgresMigrationRunner(pool, schema, POSTGRES_MIGRATIONS).migrate()
    return { b37, b38 }
  }

  it('copies shared rows to every build that uses them and keeps the rest', async () => {
    await seed()
    expect(await rowsAt(100)).toEqual([copy('GRCh37'), copy('GRCh38')])
    expect(await rowsAt(5)).toEqual([copy('GRCh37')])
    expect(await rowsAt(7)).toEqual([copy('GRCh37'), copy('GRCh38')]) // used by none: kept for all
  }, 60_000)

  it('gives GRCh37 and GRCh38 cases independent calls and comments afterwards', async () => {
    const { b37, b38 } = await seed()
    const repo = new PostgresAnnotationsRepository(pool, schema)
    await repo.upsertGlobalAnnotation('chrUn_x', 100, 'A', 'G', 'GRCh38', {
      acmg_classification: 'Benign',
      global_comment: 'b38 only'
    })
    const of = async (caseId: number) =>
      (await repo.getAnnotationsForVariant(caseId, 'chrUn_x', 100, 'A', 'G')).global
    expect(await of(b37)).toMatchObject({
      acmg_classification: 'Pathogenic',
      global_comment: 'note'
    })
    expect(await of(b38)).toMatchObject({
      acmg_classification: 'Benign',
      global_comment: 'b38 only'
    })
    const key = [{ chr: 'chrUn_x', pos: 100, ref: 'A', alt: 'G' }]
    expect((await repo.getBatch(b37, key))['chrUn_x:100:A:G'].global?.genome_build).toBe('GRCh37')
    expect((await repo.getBatch(null, key, 'GRCh38'))['chrUn_x:100:A:G'].global).toMatchObject({
      global_comment: 'b38 only'
    })
    expect((await repo.getBatch(null, key))['chrUn_x:100:A:G'].global).toBeNull()
  }, 60_000)

  it('normalises stored build aliases before the split; flags unknown ones', async () => {
    const hg19 = await addCase('hg19-case', 'hg19')
    const odd = await addCase('odd', 'my-build')
    await addVariant(hg19, 5)
    await addVariant(odd, 9)
    for (const pos of [5, 9]) {
      await probe.query(
        `INSERT INTO ${t('variant_annotations')} (chr, pos, ref, alt, global_comment, starred,
           acmg_classification, created_at, updated_at)
         VALUES ('chrUn_x', $1, 'A', 'G', 'note', 1, 'Pathogenic', 10, 20)`,
        [pos]
      )
    }
    await new PostgresMigrationRunner(pool, schema, POSTGRES_MIGRATIONS).migrate()
    const builds = await probe.query(
      `SELECT name, genome_build FROM ${t('cases_all')} ORDER BY name`
    )
    expect(builds.rows).toEqual([
      { name: 'hg19-case', genome_build: 'GRCh37' },
      { name: 'odd', genome_build: 'my-build' }
    ])
    expect(await rowsAt(5)).toEqual([copy('GRCh37')])
    expect(await rowsAt(9)).toEqual([copy('my-build')])
    const reviews = await probe.query(
      `SELECT case_id::int AS case_id, stored_build, reason FROM ${t('contig_build_review')}`
    )
    expect(reviews.rows).toEqual([
      { case_id: odd, stored_build: 'my-build', reason: 'build_unknown' }
    ])
  }, 60_000)

  it('a case confirmed in another build takes a copy of its notes along', async () => {
    const { b37 } = await seed()
    await probe.query(
      `INSERT INTO ${t('contig_build_review')} (case_id, stored_build, reason, created_at)
       VALUES ($1, 'GRCh37', 'no_evidence', 0)`,
      [b37]
    )
    await new PostgresBuildReviewRepository(pool, schema).resolveBuildReviews([
      { caseId: b37, build: 'GRCh38' }
    ])
    // 5 was GRCh37-only: now in both; 100 already had a GRCh38 row, which is kept.
    expect(await rowsAt(5)).toEqual([copy('GRCh37'), copy('GRCh38')])
    expect(await rowsAt(100)).toEqual([copy('GRCh37'), copy('GRCh38')])
  }, 60_000)
})
