/**
 * Real-PostgreSQL coverage for migration 0014's provisional import boundary.
 *
 * Gated by VARLENS_RUN_POSTGRES_E2E=1. Requires a reachable VARLENS_PG_URL.
 */
import { randomBytes } from 'node:crypto'

import { Client, Pool, type PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { POSTGRES_MIGRATIONS } from '../../../src/main/storage/postgres/migrations/definitions'
import { PostgresMigrationRunner } from '../../../src/main/storage/postgres/migrations/PostgresMigrationRunner'
import { PostgresTranscriptsRepository } from '../../../src/main/storage/postgres/PostgresTranscriptsRepository'
import { PostgresVcfImportRepository } from '../../../src/main/storage/postgres/PostgresVcfImportRepository'

const RUN = process.env.VARLENS_RUN_POSTGRES_E2E === '1'
const PG_URL =
  process.env.VARLENS_PG_URL ??
  'postgres://varlens:varlens_dev_password@127.0.0.1:55432/varlens_dev'

describe.skipIf(!RUN)('Postgres provisional import visibility — real instance', () => {
  const schema = `varlens_test_import_visibility_${Date.now()}_${randomBytes(4).toString('hex')}`
  let pool: Pool
  let probe: Client

  beforeAll(async () => {
    const provisioner = new Client({ connectionString: PG_URL })
    await provisioner.connect()
    await provisioner.query(`CREATE SCHEMA "${schema}"`)
    await provisioner.end()

    pool = new Pool({ connectionString: PG_URL, max: 2 })
    probe = new Client({ connectionString: PG_URL })
    await probe.connect()
    await new PostgresMigrationRunner(pool, schema, POSTGRES_MIGRATIONS).migrate()
  }, 60_000)

  afterAll(async () => {
    if (probe) await probe.end()
    if (pool) await pool.end()
    const cleaner = new Client({ connectionString: PG_URL })
    await cleaner.connect()
    await cleaner.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    await cleaner.end()
  }, 60_000)

  it('hides provisional rows, publishes atomically, and cleans interrupted appends by watermark', async () => {
    const repo = new PostgresVcfImportRepository(schema)
    const provisional = await repo.beginProvisionalImport(probe as never, {
      caseName: 'provisional-case',
      filePath: '/tmp/base.vcf.gz',
      fileSize: 1,
      genomeBuild: 'GRCh38'
    })

    const inserted = await probe.query<{ id: string }>(
      `INSERT INTO "${schema}"."variants_all"
         (case_id, chr, pos, ref, alt, transcript, source_format)
       VALUES ($1, '1', 100, 'A', 'T', 'old-transcript', 'vcf') RETURNING id`,
      [provisional.caseId]
    )
    const variantId = Number(inserted.rows[0].id)
    await probe.query(
      `INSERT INTO "${schema}".variant_transcripts
         (variant_id, transcript_id, gene_symbol, consequence, cdna, aa_change, is_selected)
       VALUES ($1, 'ENST-new', 'GENE1', 'MODERATE', 'c.1A>T', 'p.K1N', 0)`,
      [variantId]
    )

    const hidden = await probe.query<{ cases: string; variants: string }>(
      `SELECT (SELECT COUNT(*) FROM "${schema}"."cases") AS cases,
              (SELECT COUNT(*) FROM "${schema}"."variants") AS variants`
    )
    expect(Number(hidden.rows[0].cases)).toBe(0)
    expect(Number(hidden.rows[0].variants)).toBe(0)

    await repo.finishProvisionalImport(probe as never, provisional.caseId, 'base.vcf.gz', 'vcf')
    const visible = await probe.query<{ cases: string; variants: string }>(
      `SELECT (SELECT COUNT(*) FROM "${schema}"."cases") AS cases,
              (SELECT COUNT(*) FROM "${schema}"."variants") AS variants`
    )
    expect(Number(visible.rows[0].cases)).toBe(1)
    expect(Number(visible.rows[0].variants)).toBe(1)

    await new PostgresTranscriptsRepository(pool, schema).switchSelectedTranscript(
      variantId,
      'ENST-new'
    )
    const selected = await probe.query<{ transcript: string }>(
      `SELECT transcript FROM "${schema}"."variants_all" WHERE id = $1`,
      [variantId]
    )
    expect(selected.rows[0].transcript).toBe('ENST-new')

    const append = await repo.beginProvisionalImport(
      probe as never,
      {
        caseName: 'provisional-case',
        filePath: '/tmp/append.vcf.gz',
        fileSize: 2,
        genomeBuild: 'GRCh38'
      },
      provisional.caseId
    )
    await probe.query(
      `INSERT INTO "${schema}"."variants_all" (case_id, chr, pos, ref, alt, source_format)
       SELECT $1, '2', 1000 + n, 'C', 'G', 'vcf' FROM generate_series(1, 10001) AS n`,
      [provisional.caseId]
    )

    const cleanupSql: string[] = []
    const recordingClient = {
      query: async (sql: string | { text: string }, params?: unknown[]) => {
        const text = typeof sql === 'string' ? sql : sql.text
        cleanupSql.push(text)
        return probe.query(sql as never, params)
      }
    }
    await repo.cleanupProvisionalImport(
      recordingClient as unknown as Pick<PoolClient, 'query'>,
      append
    )

    const remaining = await probe.query<{ id: string }>(
      `SELECT id FROM "${schema}"."variants_all" WHERE case_id = $1 ORDER BY id`,
      [provisional.caseId]
    )
    expect(remaining.rows.map((row) => Number(row.id))).toEqual([variantId])
    expect(cleanupSql.filter((sql) => sql.includes('LIMIT 10000'))).toHaveLength(3)
    expect(cleanupSql.every((sql) => !sql.includes('LIMIT 10001'))).toBe(true)

    const restored = await probe.query<{ import_status: string }>(
      `SELECT import_status FROM "${schema}"."cases_all" WHERE id = $1`,
      [provisional.caseId]
    )
    expect(restored.rows[0].import_status).toBe('ready')

    // The public names remain the compatibility write surface for ordinary
    // ready-case lifecycle operations.  In particular, `variants` must stay
    // automatically updatable; a joined visibility view would make every
    // non-import INSERT/UPDATE/DELETE fail at runtime.
    const ordinaryCase = await probe.query<{ id: string }>(
      `INSERT INTO "${schema}"."cases"
         (name, file_path, file_size, variant_count, created_at, genome_build)
       VALUES ('ordinary-ready-case', '/tmp/ordinary.vcf', 1, 0, 1, 'GRCh38')
       RETURNING id`
    )
    const ordinaryCaseId = Number(ordinaryCase.rows[0].id)
    const ordinaryVariant = await probe.query<{ id: string }>(
      `INSERT INTO "${schema}"."variants"
         (case_id, chr, pos, ref, alt, source_format)
       VALUES ($1, '3', 300, 'G', 'A', 'vcf') RETURNING id`,
      [ordinaryCaseId]
    )
    const ordinaryVariantId = Number(ordinaryVariant.rows[0].id)
    await probe.query(`UPDATE "${schema}"."variants" SET qual = 42 WHERE id = $1`, [
      ordinaryVariantId
    ])
    const updated = await probe.query<{ qual: number }>(
      `SELECT qual FROM "${schema}"."variants_all" WHERE id = $1`,
      [ordinaryVariantId]
    )
    expect(updated.rows[0].qual).toBe(42)
    await probe.query(`DELETE FROM "${schema}"."variants" WHERE id = $1`, [ordinaryVariantId])
    await probe.query(`DELETE FROM "${schema}"."cases" WHERE id = $1`, [ordinaryCaseId])
  }, 60_000)

  it('recovers an interrupted import in bounded cleanup and remains idempotent', async () => {
    const repo = new PostgresVcfImportRepository(schema)
    const provisional = await repo.beginProvisionalImport(probe as never, {
      caseName: 'interrupted-recovery-case',
      filePath: '/tmp/interrupted.vcf.gz',
      fileSize: 1,
      genomeBuild: 'GRCh38'
    })
    await probe.query(
      `INSERT INTO "${schema}"."variants_all"
         (case_id, chr, pos, ref, alt, source_format)
       VALUES ($1, '4', 400, 'A', 'C', 'vcf')`,
      [provisional.caseId]
    )

    const hidden = await probe.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM "${schema}"."cases" WHERE id = $1`,
      [provisional.caseId]
    )
    expect(Number(hidden.rows[0].count)).toBe(0)

    await repo.recoverInterruptedImports(probe as never)
    await repo.recoverInterruptedImports(probe as never)

    const recovered = await probe.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM "${schema}"."cases_all" WHERE id = $1`,
      [provisional.caseId]
    )
    expect(Number(recovered.rows[0].count)).toBe(0)
    const visible = await probe.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM "${schema}"."variants" WHERE case_id = $1`,
      [provisional.caseId]
    )
    expect(Number(visible.rows[0].count)).toBe(0)
  }, 60_000)

  it('writes COPY batches to the hidden physical table without duplicating generated fields', async () => {
    const repo = new PostgresVcfImportRepository(schema)
    const provisional = await repo.beginProvisionalImport(probe as never, {
      caseName: 'copy-provisional-case',
      filePath: '/tmp/copy.vcf.gz',
      fileSize: 1,
      genomeBuild: 'GRCh38'
    })
    await probe.query('BEGIN')
    const result = await repo.writeVcfFile(probe as never, {
      mode: 'append',
      caseId: provisional.caseId,
      caseName: 'copy-provisional-case',
      fileName: 'copy.vcf.gz',
      filePath: '/tmp/copy.vcf.gz',
      fileSize: 1,
      genomeBuild: 'GRCh38',
      caller: null,
      annotationFormat: null,
      variantType: 'snv-indel',
      variants: [
        {
          chr: '5',
          pos: 500,
          ref: 'A',
          alt: 'G',
          source_format: 'vcf',
          variant_type: 'snv'
        }
      ],
      transcripts: [],
      sv: [],
      cnv: [],
      str: []
    })
    await probe.query('COMMIT')

    expect(result).toEqual({ caseId: provisional.caseId, variantCount: 1 })
    const physical = await probe.query<{ search_document: unknown }>(
      `SELECT search_document FROM "${schema}"."variants_all" WHERE case_id = $1`,
      [provisional.caseId]
    )
    expect(physical.rows).toHaveLength(1)
    expect(physical.rows[0].search_document).not.toBeNull()
    const visible = await probe.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM "${schema}"."variants" WHERE case_id = $1`,
      [provisional.caseId]
    )
    expect(Number(visible.rows[0].count)).toBe(0)
  }, 60_000)

  it('serializes recovery ownership with the schema-scoped advisory lease', async () => {
    const contender = new Client({ connectionString: PG_URL })
    await contender.connect()
    try {
      const owner = await probe.query<{ locked: boolean }>(
        `SELECT pg_try_advisory_lock(hashtext($1), hashtext('varlens-import')) AS locked`,
        [schema]
      )
      expect(owner.rows[0].locked).toBe(true)
      const rejected = await contender.query<{ locked: boolean }>(
        `SELECT pg_try_advisory_lock(hashtext($1), hashtext('varlens-import')) AS locked`,
        [schema]
      )
      expect(rejected.rows[0].locked).toBe(false)
    } finally {
      await probe.query(`SELECT pg_advisory_unlock(hashtext($1), hashtext('varlens-import'))`, [
        schema
      ])
      await contender.end()
    }
  }, 60_000)
})
