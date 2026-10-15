import { Pool } from 'pg'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DatabaseService } from '../../../src/main/database/DatabaseService'
import { PostgresCaseMetadataRepository } from '../../../src/main/storage/postgres/PostgresCaseMetadataRepository'
import {
  CASE_FILTER_RESTORE_ID_TYPE,
  CASE_FILTER_SNAPSHOT_ID_TYPE,
  parseCaseFilterSnapshot,
  serializeCaseFilterSnapshot,
  type CaseFilterSnapshotPayload
} from '../../../src/shared/filters/case-filter-snapshot'

const initialSnapshot: CaseFilterSnapshotPayload = {
  v: 1,
  saved_at: 1700000000000,
  stamp: {
    genome_build: 'GRCh38',
    hpo_data_key: 'hpo-v1',
    variant_count: 450
  },
  filters: {
    geneSymbol: 'BRCA1',
    maxInternalAf: 0.01
  },
  searchQuery: 'BRCA1',
  sortBy: [{ key: 'cadd', order: 'desc' }]
}

const updatedSnapshot: CaseFilterSnapshotPayload = {
  ...initialSnapshot,
  saved_at: 1700000050000,
  filters: {
    geneSymbol: 'TP53',
    maxInternalAf: 0.005
  },
  searchQuery: 'TP53'
}

describe('case-filter-snapshot parity (SQLite)', () => {
  let db: DatabaseService
  let caseId: number

  beforeEach(() => {
    db = new DatabaseService(':memory:')
    caseId = db.cases.createCase('snapshot-case', '/path/to/snapshot.json', 1024)
  })

  afterEach(() => {
    db.close()
  })

  it('saves, edits, restores, and clears per-case filter snapshot with audit trail and excludes internal ID types', () => {
    db.metadata.upsertCaseExternalId(caseId, 'Lab ID', 'LAB-001')

    const rawInitial = serializeCaseFilterSnapshot(initialSnapshot)
    db.metadata.upsertCaseExternalId(caseId, CASE_FILTER_SNAPSHOT_ID_TYPE, rawInitial)

    const externalIds = db.metadata.listCaseExternalIds(caseId)
    const snapshotRow = externalIds.find((row) => row.id_type === CASE_FILTER_SNAPSHOT_ID_TYPE)
    expect(snapshotRow).toBeDefined()
    expect(parseCaseFilterSnapshot(snapshotRow?.id_value)).toEqual(initialSnapshot)

    expect(db.metadata.getDistinctExternalIdTypes()).toEqual(['Lab ID'])

    const rawUpdated = serializeCaseFilterSnapshot(updatedSnapshot)
    db.metadata.upsertCaseExternalId(caseId, CASE_FILTER_SNAPSHOT_ID_TYPE, rawUpdated)

    db.metadata.upsertCaseExternalId(caseId, CASE_FILTER_RESTORE_ID_TYPE, rawUpdated)
    expect(
      db.metadata
        .listCaseExternalIds(caseId)
        .some((row) => row.id_type === CASE_FILTER_RESTORE_ID_TYPE)
    ).toBe(false)
    expect(db.metadata.getDistinctExternalIdTypes()).toEqual(['Lab ID'])

    db.metadata.deleteCaseExternalId(caseId, CASE_FILTER_SNAPSHOT_ID_TYPE)
    expect(
      db.metadata
        .listCaseExternalIds(caseId)
        .some((row) => row.id_type === CASE_FILTER_SNAPSHOT_ID_TYPE)
    ).toBe(false)

    const auditEntries = [...db.auditLog.getByEntityKey(`case:${caseId}:filter_snapshot`)].sort(
      (a, b) => a.id - b.id
    )
    expect(auditEntries.length).toBe(4)

    const methods = auditEntries.map((entry) => JSON.parse(entry.new_value ?? '{}').method)
    expect(methods).toEqual([
      'filter_snapshot_save',
      'filter_snapshot_save',
      'filter_snapshot_restore',
      'filter_snapshot_clear'
    ])
  })
})

const runPostgresE2E = process.env.VARLENS_RUN_POSTGRES_E2E === '1'

describe.skipIf(!runPostgresE2E)('case-filter-snapshot parity (PostgreSQL)', () => {
  let pool: Pool
  let schema: string
  let repo: PostgresCaseMetadataRepository
  let caseId: number

  beforeEach(async () => {
    const connectionString =
      process.env.VARLENS_TEST_POSTGRES_URL ??
      process.env.DATABASE_URL ??
      'postgresql://varlens:varlens@localhost:5432/varlens'
    pool = new Pool({ connectionString })
    schema = `test_snapshot_${Date.now()}_${Math.floor(Math.random() * 10000)}`
    await pool.query(`CREATE SCHEMA "${schema}"`)
    await pool.query(`
      CREATE TABLE "${schema}"."case_external_ids" (
        id BIGSERIAL PRIMARY KEY,
        case_id BIGINT NOT NULL,
        id_type TEXT NOT NULL,
        id_value TEXT NOT NULL,
        created_at BIGINT NOT NULL,
        UNIQUE (case_id, id_type)
      );
      CREATE TABLE "${schema}"."audit_log" (
        id BIGSERIAL PRIMARY KEY,
        timestamp BIGINT NOT NULL,
        action_type TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_key TEXT NOT NULL,
        old_value TEXT,
        new_value TEXT,
        user_name TEXT
      );
    `)
    repo = new PostgresCaseMetadataRepository(pool, schema)
    caseId = 101
  })

  afterEach(async () => {
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    await pool.end()
  })

  it('saves, edits, restores, and clears per-case filter snapshot with audit trail and excludes internal ID types', async () => {
    await repo.upsertCaseExternalId(caseId, 'Lab ID', 'LAB-001')

    const rawInitial = serializeCaseFilterSnapshot(initialSnapshot)
    await repo.upsertCaseExternalId(caseId, CASE_FILTER_SNAPSHOT_ID_TYPE, rawInitial)

    const externalIds = (await repo.listCaseExternalIds(caseId)) as Array<{
      id_type: string
      id_value: string
    }>
    const snapshotRow = externalIds.find((row) => row.id_type === CASE_FILTER_SNAPSHOT_ID_TYPE)
    expect(snapshotRow).toBeDefined()
    expect(parseCaseFilterSnapshot(snapshotRow?.id_value)).toEqual(initialSnapshot)

    expect(await repo.getDistinctExternalIdTypes()).toEqual(['Lab ID'])

    const rawUpdated = serializeCaseFilterSnapshot(updatedSnapshot)
    await repo.upsertCaseExternalId(caseId, CASE_FILTER_SNAPSHOT_ID_TYPE, rawUpdated)

    await repo.upsertCaseExternalId(caseId, CASE_FILTER_RESTORE_ID_TYPE, rawUpdated)
    const afterRestore = (await repo.listCaseExternalIds(caseId)) as Array<{ id_type: string }>
    expect(afterRestore.some((row) => row.id_type === CASE_FILTER_RESTORE_ID_TYPE)).toBe(false)
    expect(await repo.getDistinctExternalIdTypes()).toEqual(['Lab ID'])

    await repo.deleteCaseExternalId(caseId, CASE_FILTER_SNAPSHOT_ID_TYPE)
    const afterClear = (await repo.listCaseExternalIds(caseId)) as Array<{ id_type: string }>
    expect(afterClear.some((row) => row.id_type === CASE_FILTER_SNAPSHOT_ID_TYPE)).toBe(false)

    const auditResult = await pool.query<{ id: string; new_value: string }>(
      `SELECT id, new_value FROM "${schema}"."audit_log" WHERE entity_key = $1 ORDER BY id ASC`,
      [`case:${caseId}:filter_snapshot`]
    )
    expect(auditResult.rows.length).toBe(4)
    const methods = auditResult.rows.map((row) => JSON.parse(row.new_value).method)
    expect(methods).toEqual([
      'filter_snapshot_save',
      'filter_snapshot_save',
      'filter_snapshot_restore',
      'filter_snapshot_clear'
    ])
  })
})
