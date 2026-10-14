/**
 * HPO term status (#600, spec §2): assignHpoTerm upserts excluded / key flags,
 * excluded wins over key, and the case-list filter, distinct terms and overview
 * count present terms only. The same scenario runs on SQLite and, gated by
 * VARLENS_RUN_POSTGRES_E2E=1, on PostgreSQL, which must give the same answers.
 */
import { randomBytes } from 'node:crypto'

import Database from 'better-sqlite3-multiple-ciphers'
import { Pool } from 'pg'
import { describe, expect, it } from 'vitest'

import { CaseRepository } from '../../../src/main/database/CaseRepository'
import { DatabaseOverviewService } from '../../../src/main/database/DatabaseOverviewService'
import { createKysely } from '../../../src/main/database/kysely'
import { MetadataRepository } from '../../../src/main/database/MetadataRepository'
import { runMigrations } from '../../../src/main/database/migrations'
import { initializeSchema } from '../../../src/main/database/schema'
import { POSTGRES_MIGRATIONS } from '../../../src/main/storage/postgres/migrations/definitions'
import { PostgresMigrationRunner } from '../../../src/main/storage/postgres/migrations/PostgresMigrationRunner'
import { PostgresCaseMetadataRepository } from '../../../src/main/storage/postgres/PostgresCaseMetadataRepository'
import { PostgresCasesQueryRepository } from '../../../src/main/storage/postgres/PostgresCasesQueryRepository'
import { PostgresOverviewRepository } from '../../../src/main/storage/postgres/PostgresOverviewRepository'
import type { HpoTermFlags } from '../../../src/shared/types/hpo-profile'

const RUN_PG = process.env.VARLENS_RUN_POSTGRES_E2E === '1'
const PG_URL =
  process.env.VARLENS_PG_URL ??
  'postgres://varlens:varlens_dev_password@127.0.0.1:55432/varlens_dev'

interface Backend {
  addCase(name: string): Promise<number>
  assign(caseId: number, hpoId: string, label: string, flags?: HpoTermFlags): Promise<unknown>
  terms(caseId: number): Promise<unknown[]>
  distinct(): Promise<unknown[]>
  casesWith(hpoIds: string[]): Promise<string[]>
  topPhenotypeIds(): Promise<string[]>
  /** Raw insert bypassing the repository, to probe the CHECK constraint. */
  rawExcludedKey(caseId: number): Promise<unknown>
}

const status = (t: unknown): unknown => {
  const { hpo_id, hpo_label, excluded, key } = t as Record<string, unknown>
  return { hpo_id, hpo_label, excluded, key }
}

async function scenario(b: Backend) {
  const a = await b.addCase('A')
  const bb = await b.addCase('B')
  const c = await b.addCase('C')

  const plain = status(await b.assign(a, 'HP:0001250', 'Seizure'))
  await b.assign(a, 'HP:0001250', 'Seizure', { key: true })
  // No flags on an existing row: the label updates, the status is kept.
  await b.assign(a, 'HP:0001250', 'Seizures')
  // Excluded wins: a term looked for and absent is never key.
  const normalised = status(
    await b.assign(a, 'HP:0000252', 'Microcephaly', { excluded: true, key: true })
  )
  await b.assign(bb, 'HP:0000252', 'Microcephaly')
  await b.assign(bb, 'HP:0001250', 'Epileptic seizure', {})
  await b.assign(c, 'HP:0001251', 'Ataxia', { excluded: true })

  return {
    plain,
    normalised,
    termsA: (await b.terms(a)).map(status),
    distinct: await b.distinct(),
    withMicrocephaly: await b.casesWith(['HP:0000252']),
    withAtaxia: await b.casesWith(['HP:0001251']),
    topPhenotypeIds: (await b.topPhenotypeIds()).sort(),
    rawExcludedKey: await b.rawExcludedKey(c).then(
      () => 'accepted',
      () => 'rejected'
    )
  }
}

const EXPECTED = {
  plain: { hpo_id: 'HP:0001250', hpo_label: 'Seizure', excluded: false, key: false },
  normalised: { hpo_id: 'HP:0000252', hpo_label: 'Microcephaly', excluded: true, key: false },
  termsA: [
    { hpo_id: 'HP:0000252', hpo_label: 'Microcephaly', excluded: true, key: false },
    { hpo_id: 'HP:0001250', hpo_label: 'Seizures', excluded: false, key: true }
  ],
  // Present terms only; one deterministic label per id (MIN on both backends).
  distinct: [
    { hpo_id: 'HP:0001250', hpo_label: 'Epileptic seizure' },
    { hpo_id: 'HP:0000252', hpo_label: 'Microcephaly' }
  ],
  withMicrocephaly: ['B'],
  withAtaxia: [],
  topPhenotypeIds: ['HP:0000252', 'HP:0001250', 'HP:0001250'],
  rawExcludedKey: 'rejected'
}

describe('HPO term flags on SQLite', () => {
  it('upserts, normalises and filters present terms', async () => {
    const db = new Database(':memory:')
    initializeSchema(db)
    runMigrations(db)
    const kysely = createKysely(db)
    const metadata = new MetadataRepository(db, kysely)
    const cases = new CaseRepository(db, kysely)
    const overview = new DatabaseOverviewService(db, kysely)
    const backend: Backend = {
      addCase: async (name) =>
        Number(
          db
            .prepare(
              `INSERT INTO cases (name, file_path, file_size, variant_count, created_at)
               VALUES (?, '/x', 1, 0, 0)`
            )
            .run(name).lastInsertRowid
        ),
      assign: async (...args) => metadata.assignCaseHpoTerm(...args),
      terms: async (caseId) => metadata.getCaseHpoTerms(caseId),
      distinct: async () => metadata.getDistinctHpoTerms(),
      casesWith: async (hpo_ids) =>
        cases
          .queryCases({ limit: 50, hpo_ids, sort_by: 'name', sort_order: 'asc' })
          .data.map((r) => r.name),
      topPhenotypeIds: async () =>
        overview.getDatabaseOverview().topPhenotypes.map((p) => p.hpo_id),
      rawExcludedKey: async (caseId) =>
        db
          .prepare(
            `INSERT INTO case_hpo_terms (case_id, hpo_id, hpo_label, created_at, excluded, "key")
             VALUES (?, 'HP:0000001', 'All', 0, 1, 1)`
          )
          .run(caseId)
    }
    expect(await scenario(backend)).toEqual(EXPECTED)
    db.close()
  })
})

describe.skipIf(!RUN_PG)('HPO term flags on PostgreSQL (parity with SQLite)', () => {
  it('gives the same answers', async () => {
    const schema = `vt_hpo_flags_${randomBytes(4).toString('hex')}`
    const pool = new Pool({ connectionString: PG_URL, max: 2 })
    try {
      await pool.query(`CREATE SCHEMA "${schema}"`)
      await new PostgresMigrationRunner(pool, schema, POSTGRES_MIGRATIONS).migrate()
      const metadata = new PostgresCaseMetadataRepository(pool, schema)
      const cases = new PostgresCasesQueryRepository(pool, schema)
      const overview = new PostgresOverviewRepository(pool, schema)
      const backend: Backend = {
        addCase: async (name) => {
          const r = await pool.query<{ id: string }>(
            `INSERT INTO "${schema}".cases (name, file_path, file_size, created_at, genome_build)
             VALUES ($1, '/x', 1, 0, 'GRCh38') RETURNING id`,
            [name]
          )
          return Number(r.rows[0].id)
        },
        assign: (...args) => metadata.assignCaseHpoTerm(...args),
        terms: (caseId) => metadata.getCaseHpoTerms(caseId),
        distinct: () => metadata.getDistinctHpoTerms(),
        casesWith: async (hpo_ids) =>
          (
            await cases.queryCases({ limit: 50, hpo_ids, sort_by: 'name', sort_order: 'asc' })
          ).data.map((r) => r.name),
        topPhenotypeIds: async () =>
          (await overview.getOverview()).topPhenotypes.map((p) => p.hpo_id),
        rawExcludedKey: (caseId) =>
          pool.query(
            `INSERT INTO "${schema}".case_hpo_terms
               (case_id, hpo_id, hpo_label, created_at, excluded, "key")
             VALUES ($1, 'HP:0000001', 'All', 0, TRUE, TRUE)`,
            [caseId]
          )
      }
      expect(await scenario(backend)).toEqual(EXPECTED)
    } finally {
      await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
      await pool.end()
    }
  }, 180_000)
})
