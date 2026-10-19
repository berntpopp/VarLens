import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3-multiple-ciphers'
import { AnnotationRepository } from '../../../src/main/database/AnnotationRepository'
import { AuditLogRepository } from '../../../src/main/database/AuditLogRepository'
import {
  executeSqliteWriteTask,
  type SqliteWriteRepositories
} from '../../../src/main/storage/sqlite/sqlite-write-dispatch'
import { createKysely } from '../../../src/main/database/kysely'

describe('AnnotationRepository.batchUpsertPerCaseAnnotation', () => {
  let db: Database.Database
  let repo: AnnotationRepository

  beforeEach(() => {
    db = new Database(':memory:')
    db.exec(`
      CREATE TABLE cases (id INTEGER PRIMARY KEY, name TEXT, genome_build TEXT DEFAULT 'GRCh38');
      CREATE TABLE variants (
        id INTEGER PRIMARY KEY,
        case_id INTEGER NOT NULL,
        chr TEXT, pos INTEGER, ref TEXT, alt TEXT,
        variant_type TEXT DEFAULT 'snv'
      );
      CREATE TABLE variant_annotations (
        chr TEXT, pos INTEGER, ref TEXT, alt TEXT, genome_build TEXT,
        starred INTEGER DEFAULT 0,
        comment TEXT,
        PRIMARY KEY (chr, pos, ref, alt, genome_build)
      );
      CREATE TABLE case_variant_annotations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        case_id INTEGER NOT NULL,
        variant_id INTEGER NOT NULL,
        per_case_comment TEXT,
        starred INTEGER NOT NULL DEFAULT 0,
        acmg_classification TEXT,
        acmg_evidence TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(case_id, variant_id)
      );
      CREATE TABLE variant_tags (
        case_id INTEGER NOT NULL,
        variant_id INTEGER NOT NULL,
        tag_id INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (case_id, variant_id, tag_id)
      );
      CREATE TABLE audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        action_type TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_key TEXT NOT NULL,
        old_value TEXT,
        new_value TEXT,
        user_name TEXT
      );
    `)

    // Seed cases and variants
    db.exec(`
      INSERT INTO cases (id, name) VALUES (1, 'Case 1'), (2, 'Case 2');
      INSERT INTO variants (id, case_id, chr, pos, ref, alt) VALUES
        (101, 1, 'chr1', 1000, 'A', 'T'),
        (102, 1, 'chr1', 2000, 'C', 'G'),
        (103, 1, 'chr2', 3000, 'G', 'A'),
        (201, 2, 'chr1', 1000, 'A', 'T');
    `)

    const kysely = createKysely(db)
    repo = new AnnotationRepository(db, kysely)
  })

  it('updates starred status across multiple variants in a case', () => {
    const result = repo.batchUpsertPerCaseAnnotation(1, [101, 102], { is_starred: true })
    expect(result.updatedCount).toBe(2)

    const row1 = db
      .prepare(
        'SELECT starred FROM case_variant_annotations WHERE case_id = 1 AND variant_id = 101'
      )
      .get() as { starred: number }
    const row2 = db
      .prepare(
        'SELECT starred FROM case_variant_annotations WHERE case_id = 1 AND variant_id = 102'
      )
      .get() as { starred: number }
    const row3 = db
      .prepare(
        'SELECT starred FROM case_variant_annotations WHERE case_id = 1 AND variant_id = 103'
      )
      .get()

    expect(row1.starred).toBe(1)
    expect(row2.starred).toBe(1)
    expect(row3).toBeUndefined()
  })

  it('updates ACMG classification across multiple variants in a case', () => {
    const result = repo.batchUpsertPerCaseAnnotation(1, [101, 103], {
      acmg_classification: 'Pathogenic'
    })
    expect(result.updatedCount).toBe(2)

    const row1 = db
      .prepare(
        'SELECT acmg_classification FROM case_variant_annotations WHERE case_id = 1 AND variant_id = 101'
      )
      .get() as { acmg_classification: string }
    const row3 = db
      .prepare(
        'SELECT acmg_classification FROM case_variant_annotations WHERE case_id = 1 AND variant_id = 103'
      )
      .get() as { acmg_classification: string }

    expect(row1.acmg_classification).toBe('Pathogenic')
    expect(row3.acmg_classification).toBe('Pathogenic')
  })

  it('inserts variant tags when tag_id is provided', () => {
    const result = repo.batchUpsertPerCaseAnnotation(1, [101, 102], { tag_id: 7 })
    expect(result.updatedCount).toBe(2)

    const tags = db
      .prepare('SELECT variant_id, tag_id FROM variant_tags WHERE case_id = 1')
      .all() as Array<{ variant_id: number; tag_id: number }>
    expect(tags).toHaveLength(2)
    expect(tags).toEqual(
      expect.arrayContaining([
        { variant_id: 101, tag_id: 7 },
        { variant_id: 102, tag_id: 7 }
      ])
    )
  })

  it('preserves existing unprovided fields on conflict update', () => {
    // First set starred = 1
    repo.batchUpsertPerCaseAnnotation(1, [101], { is_starred: true })

    // Now set acmg_classification without specifying is_starred
    repo.batchUpsertPerCaseAnnotation(1, [101], { acmg_classification: 'Likely pathogenic' })

    const row = db
      .prepare(
        'SELECT starred, acmg_classification FROM case_variant_annotations WHERE case_id = 1 AND variant_id = 101'
      )
      .get() as { starred: number; acmg_classification: string }
    expect(row.starred).toBe(1)
    expect(row.acmg_classification).toBe('Likely pathogenic')
  })

  it('rolls back and throws when a variant does not belong to the case', () => {
    // 201 belongs to case 2, not case 1
    let caughtError: unknown
    try {
      repo.batchUpsertPerCaseAnnotation(1, [101, 201], { is_starred: true })
    } catch (err) {
      caughtError = err
    }

    expect(caughtError).toBeInstanceOf(Error)
    expect((caughtError as Error).message).toBe('Transaction failed')
    expect((caughtError as { cause?: Error }).cause?.message).toContain('do not belong to case 1')

    // Confirm atomic rollback: 101 was NOT modified
    const row = db.prepare('SELECT * FROM case_variant_annotations WHERE variant_id = 101').get()
    expect(row).toBeUndefined()
  })

  it('returns updatedCount: 0 when variantIds is empty', () => {
    const result = repo.batchUpsertPerCaseAnnotation(1, [], { is_starred: true })
    expect(result.updatedCount).toBe(0)
  })
})

describe('executeSqliteWriteTask annotations:batchUpsertPerCaseWithAudit', () => {
  let db: Database.Database
  let repo: AnnotationRepository
  let auditLogRepo: AuditLogRepository
  let writeRepos: SqliteWriteRepositories

  beforeEach(() => {
    db = new Database(':memory:')
    db.exec(`
      CREATE TABLE cases (id INTEGER PRIMARY KEY, name TEXT, genome_build TEXT DEFAULT 'GRCh38');
      CREATE TABLE variants (
        id INTEGER PRIMARY KEY,
        case_id INTEGER NOT NULL,
        chr TEXT, pos INTEGER, ref TEXT, alt TEXT,
        variant_type TEXT DEFAULT 'snv'
      );
      CREATE TABLE case_variant_annotations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        case_id INTEGER NOT NULL,
        variant_id INTEGER NOT NULL,
        per_case_comment TEXT,
        starred INTEGER NOT NULL DEFAULT 0,
        acmg_classification TEXT,
        acmg_evidence TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(case_id, variant_id)
      );
      CREATE TABLE variant_tags (
        case_id INTEGER NOT NULL,
        variant_id INTEGER NOT NULL,
        tag_id INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (case_id, variant_id, tag_id)
      );
      CREATE TABLE audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        action_type TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_key TEXT NOT NULL,
        old_value TEXT,
        new_value TEXT,
        user_name TEXT
      );
    `)

    db.exec(`
      INSERT INTO cases (id, name) VALUES (1, 'Case 1'), (2, 'Case 2');
      INSERT INTO variants (id, case_id, chr, pos, ref, alt) VALUES
        (101, 1, 'chr1', 1000, 'A', 'T'),
        (102, 1, 'chr1', 2000, 'C', 'G'),
        (201, 2, 'chr1', 1000, 'A', 'T');
    `)

    const kysely = createKysely(db)
    repo = new AnnotationRepository(db, kysely)
    auditLogRepo = new AuditLogRepository(db, kysely)
    writeRepos = {
      annotations: repo,
      auditLog: auditLogRepo
    } as unknown as SqliteWriteRepositories
  })

  it('exercises executeSqliteWriteTask with starred: true and starred: false verifying stored column is 1 and 0', async () => {
    await executeSqliteWriteTask(writeRepos, {
      type: 'annotations:batchUpsertPerCaseWithAudit',
      params: [1, [101, 102], { starred: true }]
    })

    const row1 = db
      .prepare(
        'SELECT starred FROM case_variant_annotations WHERE case_id = 1 AND variant_id = 101'
      )
      .get() as { starred: number }
    const row2 = db
      .prepare(
        'SELECT starred FROM case_variant_annotations WHERE case_id = 1 AND variant_id = 102'
      )
      .get() as { starred: number }
    expect(row1.starred).toBe(1)
    expect(row2.starred).toBe(1)

    // Verify audit logs were written
    const auditStarEntries = db.prepare("SELECT * FROM audit_log WHERE action_type = 'star'").all()
    expect(auditStarEntries).toHaveLength(2)

    // Now unstar with starred: false
    await executeSqliteWriteTask(writeRepos, {
      type: 'annotations:batchUpsertPerCaseWithAudit',
      params: [1, [101, 102], { starred: false }]
    })

    const unstar1 = db
      .prepare(
        'SELECT starred FROM case_variant_annotations WHERE case_id = 1 AND variant_id = 101'
      )
      .get() as { starred: number }
    const unstar2 = db
      .prepare(
        'SELECT starred FROM case_variant_annotations WHERE case_id = 1 AND variant_id = 102'
      )
      .get() as { starred: number }
    expect(unstar1.starred).toBe(0)
    expect(unstar2.starred).toBe(0)

    const auditUnstarEntries = db
      .prepare("SELECT * FROM audit_log WHERE action_type = 'unstar'")
      .all()
    expect(auditUnstarEntries).toHaveLength(2)
  })

  it('rolls back atomically with zero audit logs when variant does not belong to case', async () => {
    const initialAuditCount = (
      db.prepare('SELECT count(*) as count FROM audit_log').get() as { count: number }
    ).count

    await expect(
      executeSqliteWriteTask(writeRepos, {
        type: 'annotations:batchUpsertPerCaseWithAudit',
        params: [1, [101, 201], { starred: true }]
      })
    ).rejects.toThrow()

    // 101 was not modified
    const row1 = db
      .prepare('SELECT * FROM case_variant_annotations WHERE case_id = 1 AND variant_id = 101')
      .get()
    expect(row1).toBeUndefined()

    // No audit log rows created
    const finalAuditCount = (
      db.prepare('SELECT count(*) as count FROM audit_log').get() as { count: number }
    ).count
    expect(finalAuditCount).toBe(initialAuditCount)
  })

  it('rolls back atomically with zero audit logs when a variant fails assertOverrideReason', async () => {
    // Seed variant 102 with an override evidence missing overrideReason
    db.prepare(
      `
      INSERT INTO case_variant_annotations (case_id, variant_id, acmg_classification, acmg_evidence, created_at, updated_at)
      VALUES (1, 102, 'Pathogenic', '{"is_override":true,"pathogenic":[],"benign":[]}', '2026-01-01', '2026-01-01')
    `
    ).run()

    const initialAuditCount = (
      db.prepare('SELECT count(*) as count FROM audit_log').get() as { count: number }
    ).count

    let caughtError: unknown
    try {
      await executeSqliteWriteTask(writeRepos, {
        type: 'annotations:batchUpsertPerCaseWithAudit',
        params: [1, [101, 102], { acmg_classification: 'Benign' }]
      })
    } catch (err) {
      caughtError = err
    }

    expect(caughtError).toBeInstanceOf(Error)
    expect((caughtError as Error).message).toBe('Transaction failed')
    expect((caughtError as { cause?: Error }).cause?.message).toContain('reason')

    // Variant 101 must not have been created/updated
    const row101 = db
      .prepare('SELECT * FROM case_variant_annotations WHERE case_id = 1 AND variant_id = 101')
      .get()
    expect(row101).toBeUndefined()

    // Variant 102 must still be 'Pathogenic'
    const row102 = db
      .prepare(
        'SELECT acmg_classification FROM case_variant_annotations WHERE case_id = 1 AND variant_id = 102'
      )
      .get() as { acmg_classification: string }
    expect(row102.acmg_classification).toBe('Pathogenic')

    // No audit log rows created
    const finalAuditCount = (
      db.prepare('SELECT count(*) as count FROM audit_log').get() as { count: number }
    ).count
    expect(finalAuditCount).toBe(initialAuditCount)
  })
})
