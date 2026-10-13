/**
 * Postgres-gated integration test for PostgresAnnotationsRepository.getBatch.
 *
 * Mirrors the SQLite A1 call-count guarantee against a real Postgres engine:
 *
 *   - 1 query  when caseId === null (global lookup only)
 *   - 2 queries when caseId !== null (global + per-case lookup)
 *
 * and the coordinate-keyed result shape plus the spoof-rejection guard
 * (a variantId pointing at another case must be ignored — Pass-8 #2).
 *
 * Setup (the shared dev container must already be running):
 *   make pg-reset && make pg-up
 *   make rebuild-node
 *   set -a && . ./.env.postgres.local && set +a
 *   npx vitest run tests/main/storage/postgres-annotations-batch.test.ts
 *
 * Gated by VARLENS_RUN_POSTGRES_E2E=1, mirroring the existing PG integration
 * test pattern (postgres-migrations-idempotent.test.ts). A fresh schema is
 * provisioned, all migrations run, fixtures seeded, and the schema dropped on
 * teardown.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Client, Pool } from 'pg'
import { randomBytes } from 'node:crypto'

import { POSTGRES_MIGRATIONS } from '../../../src/main/storage/postgres/migrations/definitions'
import { PostgresMigrationRunner } from '../../../src/main/storage/postgres/migrations/PostgresMigrationRunner'
import { PostgresAnnotationsRepository } from '../../../src/main/storage/postgres/PostgresAnnotationsRepository'

const RUN = process.env.VARLENS_RUN_POSTGRES_E2E === '1'
const PG_URL =
  process.env.VARLENS_PG_URL ??
  'postgres://varlens:varlens_dev_password@127.0.0.1:55432/varlens_dev'

const KEY_A = { chr: '1', pos: 12345, ref: 'A', alt: 'G' }
const KEY_B = { chr: '2', pos: 23456, ref: 'C', alt: 'T' }

describe.skipIf(!RUN)('PostgresAnnotationsRepository.getBatch — call-count guarantee', () => {
  const schema = `varlens_test_annbatch_${Date.now()}_${randomBytes(4).toString('hex')}`
  let pool: Pool
  let repository: PostgresAnnotationsRepository
  // caseA owns the seeded variants; caseB is the foreign case used to mint a
  // spoofed variantId that points across the case boundary.
  let caseAId: number
  let caseBId: number
  let variantAId: number
  let variantBId: number
  let foreignVariantId: number

  beforeAll(async () => {
    const provisioner = new Client({ connectionString: PG_URL })
    await provisioner.connect()
    await provisioner.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`)
    await provisioner.end()

    pool = new Pool({ connectionString: PG_URL, max: 2 })
    await new PostgresMigrationRunner(pool, schema, POSTGRES_MIGRATIONS).migrate()

    const seed = new Client({ connectionString: PG_URL })
    await seed.connect()
    try {
      const insertCase = async (name: string): Promise<number> => {
        const res = await seed.query<{ id: string }>(
          `INSERT INTO "${schema}"."cases" (name, file_path, file_size, created_at)
           VALUES ($1, $2, $3, $4) RETURNING id`,
          [name, `/tmp/${name}.json`, 0, Date.now()]
        )
        return Number(res.rows[0].id)
      }
      caseAId = await insertCase(`ann-batch-a-${schema}`)
      caseBId = await insertCase(`ann-batch-b-${schema}`)

      const insertVariant = async (
        caseId: number,
        key: { chr: string; pos: number; ref: string; alt: string }
      ): Promise<number> => {
        const res = await seed.query<{ id: string }>(
          `INSERT INTO "${schema}"."variants" (case_id, chr, pos, ref, alt)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [caseId, key.chr, key.pos, key.ref, key.alt]
        )
        return Number(res.rows[0].id)
      }
      variantAId = await insertVariant(caseAId, KEY_A)
      variantBId = await insertVariant(caseAId, KEY_B)
      // A variant in caseB that happens to share KEY_A's coordinates — used to
      // confirm the per-case query never leaks across the case boundary.
      foreignVariantId = await insertVariant(caseBId, KEY_A)

      // Global annotation for KEY_A only; per-case annotations for both
      // variants in caseA.
      await seed.query(
        `INSERT INTO "${schema}"."variant_annotations"
           (chr, pos, ref, alt, genome_build, global_comment, starred, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'GRCh38', $5, $6, $7, $7)`,
        [KEY_A.chr, KEY_A.pos, KEY_A.ref, KEY_A.alt, 'global note', 1, Date.now()]
      )
      const insertPerCase = async (
        caseId: number,
        variantId: number,
        comment: string
      ): Promise<void> => {
        await seed.query(
          `INSERT INTO "${schema}"."case_variant_annotations"
             (case_id, variant_id, per_case_comment, starred, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $5)`,
          [caseId, variantId, comment, 0, Date.now()]
        )
      }
      await insertPerCase(caseAId, variantAId, 'case note A')
      await insertPerCase(caseAId, variantBId, 'case note B')
      // Per-case annotation for the foreign variant in caseB (must never surface
      // when querying caseA).
      await insertPerCase(caseBId, foreignVariantId, 'foreign note')
    } finally {
      await seed.end()
    }

    repository = new PostgresAnnotationsRepository(pool, schema)
  }, 60_000)

  afterAll(async () => {
    if (pool) await pool.end()
    const cleaner = new Client({ connectionString: PG_URL })
    await cleaner.connect()
    await cleaner.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    await cleaner.end()
  }, 60_000)

  it('runs exactly 1 query when caseId === null', async () => {
    const spy = vi.spyOn(pool, 'query')
    try {
      const result = await repository.getBatch(null, [KEY_A, KEY_B], 'GRCh38')
      expect(spy).toHaveBeenCalledTimes(1)
      expect(result[`${KEY_A.chr}:${KEY_A.pos}:${KEY_A.ref}:${KEY_A.alt}`].global).toMatchObject({
        global_comment: 'global note',
        starred: 1
      })
      expect(result[`${KEY_A.chr}:${KEY_A.pos}:${KEY_A.ref}:${KEY_A.alt}`].perCase).toBeNull()
    } finally {
      spy.mockRestore()
    }
  })

  it('runs exactly 2 queries when caseId !== null', async () => {
    const spy = vi.spyOn(pool, 'query')
    try {
      await repository.getBatch(caseAId, [KEY_A, KEY_B])
      expect(spy).toHaveBeenCalledTimes(2)
    } finally {
      spy.mockRestore()
    }
  })

  it('returns coordinate-keyed Record<string, VariantAnnotationsResult>', async () => {
    const result = await repository.getBatch(caseAId, [KEY_A, KEY_B])

    const keyA = `${KEY_A.chr}:${KEY_A.pos}:${KEY_A.ref}:${KEY_A.alt}`
    const keyB = `${KEY_B.chr}:${KEY_B.pos}:${KEY_B.ref}:${KEY_B.alt}`
    expect(Object.keys(result).sort()).toEqual([keyA, keyB].sort())

    expect(result[keyA].global).toMatchObject({ global_comment: 'global note', starred: 1 })
    expect(result[keyA].perCase).toMatchObject({
      case_id: caseAId,
      variant_id: variantAId,
      per_case_comment: 'case note A'
    })

    // KEY_B has no global annotation but does have a per-case annotation.
    expect(result[keyB].global).toBeNull()
    expect(result[keyB].perCase).toMatchObject({
      case_id: caseAId,
      variant_id: variantBId,
      per_case_comment: 'case note B'
    })
  })

  it('ignores spoofed variantId pointing to another case', async () => {
    // Pass a variantId belonging to caseB while querying caseA. The defensive
    // join on both cva.case_id AND v.case_id, combined with the variantId
    // filter, must yield caseA's own annotation rather than the foreign one.
    const result = await repository.getBatch(caseAId, [
      { ...KEY_A, variantId: foreignVariantId },
      { ...KEY_B, variantId: variantBId }
    ])

    const keyA = `${KEY_A.chr}:${KEY_A.pos}:${KEY_A.ref}:${KEY_A.alt}`
    // The foreign variantId must not match anything in caseA, so KEY_A's
    // per-case annotation is filtered out entirely (the foreign note never
    // leaks).
    expect(result[keyA].perCase).toBeNull()

    const keyB = `${KEY_B.chr}:${KEY_B.pos}:${KEY_B.ref}:${KEY_B.alt}`
    expect(result[keyB].perCase).toMatchObject({
      case_id: caseAId,
      variant_id: variantBId,
      per_case_comment: 'case note B'
    })
  })
})
