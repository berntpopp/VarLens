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
import {
  renameCaseContigsPg,
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
      global_comment: 'b\n\na',
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
    ).toBeGreaterThan(0)
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

  it('a confirmed review renames the flagged case with the same rules', async () => {
    const { c } = await seed()
    await new PostgresMigrationRunner(pool, schema, POSTGRES_MIGRATIONS).migrate()
    await runJob()
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await renameCaseContigsPg(client, schema, c, [{ from: '1', to: 'chr1' }])
      await client.query('COMMIT')
    } finally {
      client.release()
    }
    expect(await chrsOf(c)).toEqual(['chr1'])
    expect(await annotation('1', 100)).toBeUndefined()
    expect(await frequencies()).toEqual(await recount())
  }, 60_000)
})
