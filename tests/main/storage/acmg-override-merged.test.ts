/**
 * #567: the override-reason rule judges the row as it will be stored (the
 * update merged over the stored row), on both backends. PostgreSQL part gated
 * by VARLENS_RUN_POSTGRES_E2E=1.
 */
import { randomBytes } from 'node:crypto'

import { Client, Pool } from 'pg'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { DatabaseService } from '../../../src/main/database/DatabaseService'
import { executeSqliteWriteTask } from '../../../src/main/storage/sqlite/sqlite-write-dispatch'
import { POSTGRES_MIGRATIONS } from '../../../src/main/storage/postgres/migrations/definitions'
import { PostgresMigrationRunner } from '../../../src/main/storage/postgres/migrations/PostgresMigrationRunner'
import { PostgresAnnotationsRepository } from '../../../src/main/storage/postgres/PostgresAnnotationsRepository'

const VUS_EVIDENCE = JSON.stringify({
  pathogenic: [{ code: 'PM2', strength: 'supporting', confirmed: true }],
  benign: []
})
const PATHOGENIC_EVIDENCE = JSON.stringify({
  pathogenic: [
    { code: 'PVS1', strength: 'very_strong', confirmed: true },
    { code: 'PS1', strength: 'strong', confirmed: true }
  ],
  benign: []
})
/** A legacy override saved before a reason was required. */
const LEGACY_OVERRIDE = JSON.stringify({
  pathogenic: [{ code: 'PM2', strength: 'supporting', confirmed: true }],
  benign: [],
  is_override: true
})

type Write = (updates: Record<string, unknown>) => Promise<unknown>

/** The same cases against a stored row `seed` sets up, for any backend. */
function overrideCases(
  seed: (classification: string, evidence: string) => Promise<void>,
  writeGlobal: () => Write,
  writePerCase: () => Write
): void {
  for (const [scope, write] of [
    ['global', writeGlobal],
    ['per-case', writePerCase]
  ] as const) {
    describe(scope, () => {
      it('a class alone that contradicts the stored evidence is refused', async () => {
        await seed('Uncertain significance', VUS_EVIDENCE)
        await expect(write()({ acmg_classification: 'Pathogenic' })).rejects.toThrow(/reason/)
      })

      it('evidence alone that changes the class of the stored one is refused', async () => {
        await seed('Uncertain significance', VUS_EVIDENCE)
        await expect(write()({ acmg_evidence: PATHOGENIC_EVIDENCE })).rejects.toThrow(/reason/)
      })

      it('a star on a legacy reasonless override still saves', async () => {
        await seed('Benign', LEGACY_OVERRIDE)
        await expect(write()({ starred: true })).resolves.toBeDefined()
      })

      it('a class agreeing with the stored evidence saves', async () => {
        await seed('Benign', VUS_EVIDENCE)
        await expect(write()({ acmg_classification: 'Uncertain significance' })).resolves.toBeDefined()
      })
    })
  }
}

describe('ACMG override reason on the merged row — SQLite', () => {
  let db: DatabaseService
  let caseId: number
  let variantId: number
  const coords = { chr: '1', pos: 10, ref: 'A', alt: 'G', genome_build: 'GRCh38' }

  beforeEach(() => {
    db = new DatabaseService(':memory:')
    caseId = db.cases.createCase('c', '/tmp/c.json', 0, 'GRCh38')
    variantId = Number(
      db.database
        .prepare("INSERT INTO variants (case_id, chr, pos, ref, alt) VALUES (?, '1', 10, 'A', 'G')")
        .run(caseId).lastInsertRowid
    )
  })
  afterEach(() => db.close())

  overrideCases(
    async (classification, evidence) => {
      db.annotations.upsertGlobalAnnotation('1', 10, 'A', 'G', 'GRCh38', {
        acmg_classification: classification as never,
        acmg_evidence: evidence
      })
      db.annotations.upsertPerCaseAnnotation(caseId, variantId, {
        acmg_classification: classification as never,
        acmg_evidence: evidence
      })
    },
    () => (updates) =>
      executeSqliteWriteTask(db as never, {
        type: 'annotations:upsertGlobalWithAudit',
        params: [coords, updates]
      }),
    () => (updates) =>
      executeSqliteWriteTask(db as never, {
        type: 'annotations:upsertPerCaseWithAudit',
        params: [caseId, variantId, updates]
      })
  )
})

const RUN = process.env.VARLENS_RUN_POSTGRES_E2E === '1'
const PG_URL =
  process.env.VARLENS_PG_URL ??
  'postgres://varlens:varlens_dev_password@127.0.0.1:55432/varlens_dev'

describe.skipIf(!RUN)('ACMG override reason on the merged row — PostgreSQL', () => {
  let schema: string
  let pool: Pool
  let probe: Client
  let caseId: number
  let variantId: number
  let repo: PostgresAnnotationsRepository

  beforeAll(async () => {
    schema = `varlens_test_override_${Date.now()}_${randomBytes(4).toString('hex')}`
    pool = new Pool({ connectionString: PG_URL, max: 3 })
    probe = new Client({ connectionString: PG_URL })
    await probe.connect()
    await probe.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`)
    await new PostgresMigrationRunner(pool, schema, POSTGRES_MIGRATIONS).migrate()
    caseId = Number(
      (
        await probe.query<{ id: string }>(
          `INSERT INTO "${schema}".cases_all (name, file_path, file_size, created_at, genome_build)
           VALUES ('c', '/tmp/c.json', 0, 0, 'GRCh38') RETURNING id`
        )
      ).rows[0].id
    )
    variantId = Number(
      (
        await probe.query<{ id: string }>(
          `INSERT INTO "${schema}".variants_all (case_id, chr, pos, ref, alt)
           VALUES ($1, '1', 10, 'A', 'G') RETURNING id`,
          [caseId]
        )
      ).rows[0].id
    )
    repo = new PostgresAnnotationsRepository(pool, schema)
  }, 120_000)

  afterAll(async () => {
    await probe.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    await probe.end()
    await pool.end()
  }, 60_000)

  overrideCases(
    async (classification, evidence) => {
      const fields = { acmg_classification: classification as never, acmg_evidence: evidence }
      await repo.upsertGlobalAnnotation('1', 10, 'A', 'G', 'GRCh38', fields)
      await repo.upsertPerCaseAnnotation(caseId, variantId, fields)
    },
    () => (updates) =>
      repo.upsertGlobalAnnotationWithAudit('1', 10, 'A', 'G', 'GRCh38', updates as never),
    () => (updates) => repo.upsertPerCaseAnnotationWithAudit(caseId, variantId, updates as never)
  )
})
