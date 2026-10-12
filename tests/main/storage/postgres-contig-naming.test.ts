/**
 * Migration 0029 + the chromosome-name job against a real PostgreSQL
 * (mirrors SQLite v46, tests/main/database/migration-v46.test.ts).
 *
 * Gated by VARLENS_RUN_POSTGRES_E2E=1. Requires `make pg-up`.
 */
import { randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Client, Pool } from 'pg'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { POSTGRES_MIGRATIONS } from '../../../src/main/storage/postgres/migrations/definitions'
import { PostgresMigrationRunner } from '../../../src/main/storage/postgres/migrations/PostgresMigrationRunner'
import { PostgresBuildReviewRepository } from '../../../src/main/storage/postgres/PostgresBuildReviewRepository'
import {
  awaitContigNaming,
  runContigNamingStep
} from '../../../src/main/storage/postgres/postgres-contig-naming'

const RUN = process.env.VARLENS_RUN_POSTGRES_E2E === '1'
const PG_URL =
  process.env.VARLENS_PG_URL ??
  'postgres://varlens:varlens_dev_password@127.0.0.1:55432/varlens_dev'

const GRCH38_HEADER = '##fileformat=VCFv4.2\n##contig=<ID=1,length=248956422>\n#CHROM\tPOS\n'
const GRCH37_TAG = '##fileformat=VCFv4.2\n##reference=file:///ref/hs37d5.fa\n#CHROM\tPOS\n'

describe.skipIf(!RUN)('migration 0029 + chromosome-name job (PostgreSQL)', () => {
  let schema: string
  let pool: Pool
  let probe: Client
  let dir: string
  const t = (table: string): string => `"${schema}"."${table}"`

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'pg-0029-'))
    schema = `varlens_test_contig_${Date.now()}_${randomBytes(4).toString('hex')}`
    pool = new Pool({ connectionString: PG_URL, max: 3 })
    probe = new Client({ connectionString: PG_URL })
    await probe.connect()
    await probe.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`)
    await new PostgresMigrationRunner(
      pool,
      schema,
      POSTGRES_MIGRATIONS.filter((m) => m.version < '0029')
    ).migrate()
  }, 120_000)

  afterEach(async () => {
    await probe.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    await probe.end()
    await pool.end()
    rmSync(dir, { recursive: true, force: true })
  }, 60_000)

  async function addCase(name: string, build: string, header: string | null): Promise<number> {
    let path = join(dir, `${name}.json`)
    if (header !== null) {
      path = join(dir, `${name}.vcf`)
      writeFileSync(path, header)
    }
    const r = await probe.query<{ id: string }>(
      `INSERT INTO ${t('cases_all')} (name, file_path, file_size, created_at, genome_build)
       VALUES ($1, $2, 0, 0, $3) RETURNING id`,
      [name, path, build]
    )
    return Number(r.rows[0].id)
  }
  const addVariant = (caseId: number, chr: string, pos: number): Promise<unknown> =>
    probe.query(
      `INSERT INTO ${t('variants_all')} (case_id, chr, pos, ref, alt) VALUES ($1, $2, $3, 'A', 'G')`,
      [caseId, chr, pos]
    )
  const annotate = (
    chr: string,
    pos: number,
    comment: string,
    starred: number,
    acmg: string | null,
    updated: number
  ): Promise<unknown> =>
    probe.query(
      `INSERT INTO ${t('variant_annotations')} (chr, pos, ref, alt, global_comment, starred, acmg_classification, created_at, updated_at)
       VALUES ($1, $2, 'A', 'G', $3, $4, $5, 0, $6)`,
      [chr, pos, comment, starred, acmg, updated]
    )
  const chrsOf = async (caseId: number): Promise<string[]> =>
    (
      await probe.query<{ chr: string }>(
        `SELECT chr FROM ${t('variants_all')} WHERE case_id = $1 GROUP BY chr ORDER BY chr COLLATE "C"`,
        [caseId]
      )
    ).rows.map((r) => r.chr)
  const annotation = async (chr: string, pos: number): Promise<unknown> =>
    (
      await probe.query(
        `SELECT global_comment, starred, acmg_classification FROM ${t('variant_annotations')} WHERE chr = $1 AND pos = $2`,
        [chr, pos]
      )
    ).rows[0]
  const frequencies = async (): Promise<unknown[]> =>
    (
      await probe.query(
        `SELECT chr, pos::int AS pos, case_count::int AS n FROM ${t('variant_frequency')} ORDER BY chr COLLATE "C", pos`
      )
    ).rows
  const recount = async (): Promise<unknown[]> =>
    (
      await probe.query(
        `SELECT chr, pos::int AS pos, COUNT(DISTINCT case_id)::int AS n FROM ${t('variants')}
          GROUP BY chr, pos ORDER BY chr COLLATE "C", pos`
      )
    ).rows
  const runJob = async (): Promise<void> => {
    while (await runContigNamingStep({ pool, schema })) {
      // one case per transaction
    }
  }

  async function seed() {
    const a = await addCase('A', 'GRCh38', GRCH38_HEADER)
    const b = await addCase('B', 'GRCh37', GRCH37_TAG)
    const c = await addCase('C', 'GRCh38', null)
    const d = await addCase('D', 'GRCh38', null)
    for (const pos of [100, 300]) await addVariant(a, '1', pos)
    await addVariant(a, 'MT', 50)
    await addVariant(b, 'chr1', 400)
    await addVariant(b, 'chrM', 60)
    await addVariant(c, '1', 100)
    await addVariant(d, 'chr1', 100)
    await probe.query(
      `INSERT INTO ${t('variant_frequency')} (chr, pos, ref, alt, case_count)
       SELECT chr, pos, ref, alt, COUNT(DISTINCT case_id) FROM ${t('variants')} GROUP BY chr, pos, ref, alt`
    )
    await annotate('1', 100, 'a', 1, 'Benign', 1)
    await annotate('chr1', 100, 'b', 0, 'Pathogenic', 2)
    await annotate('1', 300, 'only A', 0, null, 1)
    return { a, b, c, d }
  }

  it('queues every case, renames confirmed ones one per transaction, flags the rest', async () => {
    const { a, b, c, d } = await seed()
    await new PostgresMigrationRunner(pool, schema, POSTGRES_MIGRATIONS).migrate()
    expect(
      (await probe.query(`SELECT COUNT(*)::int AS n FROM ${t('contig_naming_pending')}`)).rows[0].n
    ).toBe(4)

    await runJob()

    expect(await chrsOf(a)).toEqual(['chr1', 'chrM'])
    expect(await chrsOf(b)).toEqual(['1', 'chrM'])
    expect(await chrsOf(c)).toEqual(['1'])
    expect(await chrsOf(d)).toEqual(['chr1'])
    expect(
      (await probe.query(`SELECT case_id::int AS case_id, reason FROM ${t('contig_build_review')}`))
        .rows
    ).toEqual([{ case_id: c, reason: 'no_evidence' }])
    expect(await annotation('chr1', 100)).toEqual({
      global_comment: 'a\n\nb',
      starred: 1,
      acmg_classification: 'Pathogenic'
    })
    expect(await annotation('1', 100)).toMatchObject({ global_comment: 'a' }) // C still uses it
    expect(await annotation('1', 300)).toBeUndefined()
    expect(await annotation('chr1', 300)).toMatchObject({ global_comment: 'only A' })
    const audit = await probe.query(
      `SELECT entity_key, old_value FROM varlens_audit."audit_log" WHERE project_schema = $1`,
      [schema]
    )
    expect(audit.rows).toHaveLength(1)
    expect(audit.rows[0].entity_key).toBe('chr1:100:A:G')
    expect(await frequencies()).toEqual(await recount())
    expect(
      (await probe.query(`SELECT COUNT(*)::int AS n FROM ${t('cohort_summary_rebuild_requests')}`))
        .rows[0].n
    ).toBe(1) // one rebuild, asked when the queue emptied
    expect(
      (await probe.query(`SELECT COUNT(*)::int AS n FROM ${t('contig_naming_pending')}`)).rows[0].n
    ).toBe(0)
  }, 60_000)

  it('is idempotent: running the job again changes nothing', async () => {
    await seed()
    await new PostgresMigrationRunner(pool, schema, POSTGRES_MIGRATIONS).migrate()
    await runJob()
    const before = (await probe.query(`SELECT id, chr FROM ${t('variants_all')} ORDER BY id`)).rows
    const annotations = (await probe.query(`SELECT * FROM ${t('variant_annotations')} ORDER BY id`))
      .rows
    await probe.query(
      `INSERT INTO ${t('contig_naming_pending')} (case_id) SELECT id FROM ${t('cases')}`
    )
    await runJob()
    expect(
      (await probe.query(`SELECT id, chr FROM ${t('variants_all')} ORDER BY id`)).rows
    ).toEqual(before)
    expect(
      (await probe.query(`SELECT * FROM ${t('variant_annotations')} ORDER BY id`)).rows
    ).toEqual(annotations)
  }, 60_000)

  const migrate = (): Promise<unknown> =>
    new PostgresMigrationRunner(pool, schema, POSTGRES_MIGRATIONS).migrate()
  const count = async (table: string): Promise<number> =>
    (await probe.query(`SELECT COUNT(*)::int AS n FROM ${t(table)}`)).rows[0].n

  it('a GRCh38 1 / hg19 chr1 swap keeps each note with its own locus', async () => {
    const a = await addCase('A', 'GRCh38', GRCH38_HEADER)
    const c = await addCase('C', 'GRCh37', GRCH37_TAG)
    await addVariant(a, '1', 100)
    await addVariant(c, 'chr1', 100)
    await annotate('1', 100, 'GRCh38 note', 0, 'Benign', 1)
    await annotate('chr1', 100, 'GRCh37 note', 0, 'Pathogenic', 2)
    await migrate()
    await runJob()
    expect(await chrsOf(a)).toEqual(['chr1'])
    expect(await chrsOf(c)).toEqual(['1'])
    expect(await annotation('chr1', 100)).toMatchObject({ global_comment: 'GRCh38 note' })
    expect(await annotation('1', 100)).toMatchObject({ global_comment: 'GRCh37 note' })
  }, 60_000)

  it('a shared note stays with a renamed GRCh37 case that keeps its key (1 + chrMT)', async () => {
    const a = await addCase('A', 'GRCh38', GRCH38_HEADER)
    const e = await addCase('E', 'GRCh37', GRCH37_TAG)
    await addVariant(a, '1', 100)
    await addVariant(e, '1', 100)
    await addVariant(e, 'chrMT', 50)
    await annotate('1', 100, 'shared note', 0, null, 1)
    await migrate()
    await runJob()
    expect(await chrsOf(e)).toEqual(['1', 'MT'])
    expect(await annotation('1', 100)).toMatchObject({ global_comment: 'shared note' })
    expect(await annotation('chr1', 100)).toMatchObject({ global_comment: 'shared note' })
  }, 60_000)

  it('resolveBuildReviews confirms many cases in one write, audit-logged, renamed by the job', async () => {
    const ids: number[] = []
    for (const name of ['P1', 'P2', 'P3']) {
      const id = await addCase(name, 'GRCh38', null)
      await addVariant(id, '1', 100)
      ids.push(id)
    }
    await migrate()
    await runJob()
    const repo = new PostgresBuildReviewRepository(pool, schema)
    const listed = await repo.listBuildReviews()
    expect(listed.reviews.map((r) => r.caseId)).toEqual(ids)
    expect(listed.renameInProgress).toBe(false)
    expect(await repo.resolveBuildReviews(ids.map((caseId) => ({ caseId, build: 'GRCh37' })))).toBe(
      3
    )
    expect((await repo.listBuildReviews()).renameInProgress).toBe(true)
    // The confirmation also started the background job: let both finish.
    await runJob()
    await awaitContigNaming(schema)
    for (const id of ids) expect(await chrsOf(id)).toEqual(['1'])
    expect(await repo.listBuildReviews()).toEqual({ reviews: [], renameInProgress: false })
    const audit = await probe.query(
      `SELECT entity_key, old_value, new_value FROM varlens_audit."audit_log"
        WHERE project_schema = $1 AND action_type = 'api_write' ORDER BY id`,
      [schema]
    )
    expect(audit.rows).toHaveLength(3)
    expect(audit.rows[0]).toMatchObject({ entity_key: `cases:${ids[0]}:genome_build` })
    expect(JSON.parse(audit.rows[0].new_value)).toMatchObject({ genome_build: 'GRCh37' })
    await expect(repo.resolveBuildReviews([{ caseId: ids[0], build: 'GRCh38' }])).rejects.toThrow(
      /no genome build/
    )
  }, 60_000)

  it('a job killed mid-case rolls that case back and resumes on the next run', async () => {
    const { a } = await seed()
    await migrate()
    let failOnce = true
    const flaky = {
      connect: async () => {
        const client = await pool.connect()
        const query = client.query.bind(client) as (...args: unknown[]) => Promise<unknown>
        ;(client as unknown as { query: unknown }).query = (...args: unknown[]) => {
          const text = typeof args[0] === 'string' ? args[0] : ''
          if (failOnce && text.includes('"variants_all" SET chr')) {
            failOnce = false
            return Promise.reject(new Error('killed mid-case'))
          }
          return query(...args)
        }
        return client
      }
    }
    await expect(
      (async () => {
        while (await runContigNamingStep({ pool: flaky as never, schema })) {
          // until the injected failure
        }
      })()
    ).rejects.toThrow('killed mid-case')
    expect(await chrsOf(a)).toEqual(['1', 'MT']) // rolled back, still queued
    expect(await count('contig_naming_pending')).toBeGreaterThan(0)
    await runJob()
    expect(await chrsOf(a)).toEqual(['chr1', 'chrM'])
    expect(await frequencies()).toEqual(await recount())
    expect(await count('contig_naming_pending')).toBe(0)
  }, 60_000)

  it('an import and an annotation edit during the job are kept', async () => {
    const { a } = await seed()
    await migrate()
    // Plan every case, then let a user act before annotations move.
    while (
      (await probe.query(`SELECT 1 FROM ${t('contig_naming_pending')} WHERE pairs IS NULL`)).rows
        .length > 0 ||
      (await count('contig_naming_pending')) === 4
    ) {
      if (!(await runContigNamingStep({ pool, schema }))) break
    }
    const late = await addCase('LATE', 'GRCh38', null)
    await addVariant(late, 'chr1', 300)
    // What a publication counts for the new case (it is not queued: already canonical).
    await probe.query(
      `INSERT INTO ${t('variant_frequency')} (chr, pos, ref, alt, case_count)
       VALUES ('chr1', 300, 'A', 'G', 1)
       ON CONFLICT (coord_hash) DO UPDATE SET case_count = ${t('variant_frequency')}.case_count + 1`
    )
    await probe.query(
      `UPDATE ${t('variant_annotations')} SET global_comment = 'edited', updated_at = 5
        WHERE chr = '1' AND pos = 300`
    )
    await runJob()
    expect(await chrsOf(a)).toEqual(['chr1', 'chrM'])
    expect(await chrsOf(late)).toEqual(['chr1'])
    expect(await annotation('chr1', 300)).toMatchObject({ global_comment: 'edited' })
    expect(await frequencies()).toEqual(await recount())
  }, 60_000)
})
