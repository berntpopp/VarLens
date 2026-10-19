import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3-multiple-ciphers'
import { AnnotationRepository } from '../../../src/main/database/AnnotationRepository'
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
