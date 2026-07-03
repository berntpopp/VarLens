/**
 * CohortSummaryService + trigger tests
 *
 * Tests annotation trigger sync behavior:
 * - Starring a variant updates has_star in summary
 * - Adding a comment updates has_comment in summary
 * - Setting ACMG classification updates acmg_best
 * - Deleting annotation reverts flags
 * - ACMG ranking: Pathogenic > Likely pathogenic > VUS > Likely benign > Benign
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3-multiple-ciphers'
import { initializeSchema } from '../../../src/main/database/schema'
import { runMigrations } from '../../../src/main/database/migrations'
import { CohortSummaryService } from '../../../src/main/database/CohortSummaryService'

describe('Annotation Triggers', () => {
  let db: Database.Database
  let summaryService: CohortSummaryService

  const insertCase = (name: string): number => {
    return db
      .prepare(
        'INSERT INTO cases (name, file_path, file_size, variant_count, created_at) VALUES (?, ?, ?, ?, ?)'
      )
      .run(name, `/test/${name}.json`, 1000, 0, Date.now()).lastInsertRowid as number
  }

  const insertVariant = (
    caseId: number,
    chr: string,
    pos: number,
    ref: string,
    alt: string
  ): number => {
    return db
      .prepare(
        'INSERT INTO variants (case_id, chr, pos, ref, alt, gene_symbol, gt_num) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      .run(caseId, chr, pos, ref, alt, 'BRCA1', '0/1').lastInsertRowid as number
  }

  const getSummaryRow = (chr: string, pos: number, ref: string, alt: string) => {
    return db
      .prepare(
        'SELECT has_star, has_comment, acmg_best FROM cohort_variant_summary WHERE chr = ? AND pos = ? AND ref = ? AND alt = ?'
      )
      .get(chr, pos, ref, alt) as
      { has_star: number; has_comment: number; acmg_best: string | null } | undefined
  }

  beforeEach(() => {
    db = new Database(':memory:')
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    initializeSchema(db)
    runMigrations(db)
    summaryService = new CohortSummaryService(db)

    // Insert test data
    const caseId = insertCase('test-case')
    insertVariant(caseId, '1', 12345, 'A', 'G')
    summaryService.rebuild()
  })

  afterEach(() => {
    db.close()
  })

  it('should set has_star=1 when global annotation is starred', () => {
    db.prepare(
      `INSERT INTO variant_annotations (chr, pos, ref, alt, starred, created_at, updated_at)
       VALUES ('1', 12345, 'A', 'G', 1, 0, 0)`
    ).run()

    const row = getSummaryRow('1', 12345, 'A', 'G')
    expect(row?.has_star).toBe(1)
  })

  it('should revert has_star=0 when global star is deleted', () => {
    db.prepare(
      `INSERT INTO variant_annotations (chr, pos, ref, alt, starred, created_at, updated_at)
       VALUES ('1', 12345, 'A', 'G', 1, 0, 0)`
    ).run()
    db.prepare(
      `DELETE FROM variant_annotations WHERE chr = '1' AND pos = 12345 AND ref = 'A' AND alt = 'G'`
    ).run()

    const row = getSummaryRow('1', 12345, 'A', 'G')
    expect(row?.has_star).toBe(0)
  })

  it('should pick most pathogenic ACMG classification', () => {
    db.prepare(
      `INSERT INTO variant_annotations (chr, pos, ref, alt, acmg_classification, created_at, updated_at)
       VALUES ('1', 12345, 'A', 'G', 'Likely benign', 0, 0)`
    ).run()

    expect(getSummaryRow('1', 12345, 'A', 'G')?.acmg_best).toBe('Likely benign')

    // Per-case annotation with higher pathogenicity should win
    const variantId = db
      .prepare(
        "SELECT id FROM variants WHERE chr = '1' AND pos = 12345 AND ref = 'A' AND alt = 'G'"
      )
      .get() as { id: number }

    db.prepare(
      `INSERT INTO case_variant_annotations (case_id, variant_id, acmg_classification, created_at, updated_at)
       VALUES (1, ?, 'Pathogenic', 0, 0)`
    ).run(variantId.id)

    expect(getSummaryRow('1', 12345, 'A', 'G')?.acmg_best).toBe('Pathogenic')
  })

  it('should set has_comment=1 when global comment is added', () => {
    db.prepare(
      `INSERT INTO variant_annotations (chr, pos, ref, alt, starred, global_comment, created_at, updated_at)
       VALUES ('1', 12345, 'A', 'G', 0, 'important finding', 0, 0)`
    ).run()

    const row = getSummaryRow('1', 12345, 'A', 'G')
    expect(row?.has_comment).toBe(1)
    expect(row?.has_star).toBe(0)
  })

  it('should rank ACMG classifications: Pathogenic > LP > VUS > LB > Benign', () => {
    // Start with Benign
    db.prepare(
      `INSERT INTO variant_annotations (chr, pos, ref, alt, acmg_classification, created_at, updated_at)
       VALUES ('1', 12345, 'A', 'G', 'Benign', 0, 0)`
    ).run()
    expect(getSummaryRow('1', 12345, 'A', 'G')?.acmg_best).toBe('Benign')

    // Update to Uncertain significance — should upgrade
    db.prepare(
      `UPDATE variant_annotations SET acmg_classification = 'Uncertain significance' WHERE chr = '1' AND pos = 12345`
    ).run()
    expect(getSummaryRow('1', 12345, 'A', 'G')?.acmg_best).toBe('Uncertain significance')

    // Update to Likely pathogenic — should upgrade
    db.prepare(
      `UPDATE variant_annotations SET acmg_classification = 'Likely pathogenic' WHERE chr = '1' AND pos = 12345`
    ).run()
    expect(getSummaryRow('1', 12345, 'A', 'G')?.acmg_best).toBe('Likely pathogenic')
  })
})

describe('Incremental updates', () => {
  let db: Database.Database
  let summaryService: CohortSummaryService

  const insertCase = (name: string): number => {
    return db
      .prepare(
        'INSERT INTO cases (name, file_path, file_size, variant_count, created_at) VALUES (?, ?, ?, ?, ?)'
      )
      .run(name, `/test/${name}.json`, 1000, 0, Date.now()).lastInsertRowid as number
  }

  const insertVariant = (
    caseId: number,
    chr: string,
    pos: number,
    ref: string,
    alt: string
  ): number => {
    return db
      .prepare(
        'INSERT INTO variants (case_id, chr, pos, ref, alt, gene_symbol, gt_num) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      .run(caseId, chr, pos, ref, alt, 'BRCA1', '0/1').lastInsertRowid as number
  }

  beforeEach(() => {
    db = new Database(':memory:')
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    initializeSchema(db)
    runMigrations(db)
    summaryService = new CohortSummaryService(db)
  })

  afterEach(() => {
    db.close()
  })

  it('should incrementally add a case without full rebuild', () => {
    const case1 = insertCase('case1')
    insertVariant(case1, '1', 100, 'A', 'G')
    insertVariant(case1, '1', 200, 'C', 'T')
    summaryService.rebuild()

    // Add second case sharing one variant
    const case2 = insertCase('case2')
    insertVariant(case2, '1', 100, 'A', 'G')
    insertVariant(case2, '1', 300, 'G', 'A')
    summaryService.incrementalAdd(case2)

    const shared = db
      .prepare(
        "SELECT carrier_count, cohort_frequency FROM cohort_variant_summary WHERE chr = '1' AND pos = 100"
      )
      .get() as { carrier_count: number; cohort_frequency: number }
    expect(shared.carrier_count).toBe(2)
    expect(shared.cohort_frequency).toBeCloseTo(1.0) // 2 carriers / 2 cases

    const case1Only = db
      .prepare(
        "SELECT carrier_count, cohort_frequency FROM cohort_variant_summary WHERE chr = '1' AND pos = 200"
      )
      .get() as { carrier_count: number; cohort_frequency: number }
    expect(case1Only.cohort_frequency).toBeCloseTo(0.5) // 1 carrier / 2 cases

    const newVariant = db
      .prepare("SELECT carrier_count FROM cohort_variant_summary WHERE chr = '1' AND pos = 300")
      .get() as { carrier_count: number }
    expect(newVariant.carrier_count).toBe(1)

    const total = db.prepare('SELECT COUNT(*) as c FROM cohort_variant_summary').get() as {
      c: number
    }
    expect(total.c).toBe(3) // 100, 200, 300
  })

  it('should incrementally remove a case without full rebuild', () => {
    const case1 = insertCase('case1')
    insertVariant(case1, '1', 100, 'A', 'G')
    insertVariant(case1, '1', 200, 'C', 'T')
    const case2 = insertCase('case2')
    insertVariant(case2, '1', 100, 'A', 'G')
    summaryService.rebuild()

    // Remove case2 (shares variant at pos 100)
    summaryService.incrementalRemove(case2)
    db.prepare('DELETE FROM cases WHERE id = ?').run(case2)

    const shared = db
      .prepare(
        "SELECT carrier_count, cohort_frequency FROM cohort_variant_summary WHERE chr = '1' AND pos = 100"
      )
      .get() as { carrier_count: number; cohort_frequency: number }
    expect(shared.carrier_count).toBe(1)
    // Frequency recomputed during incrementalRemove (before case delete) uses 2 cases
    // After case delete, stored frequency is stale (marked stale for full rebuild)
    expect(shared.cohort_frequency).toBeCloseTo(0.5) // 1 carrier / 2 cases (pre-delete count)

    // Variant at 200 should be unchanged
    const unchanged = db
      .prepare("SELECT carrier_count FROM cohort_variant_summary WHERE chr = '1' AND pos = 200")
      .get() as { carrier_count: number }
    expect(unchanged.carrier_count).toBe(1)
  })

  it('should remove summary rows with zero carriers after incremental remove', () => {
    const case1 = insertCase('case1')
    insertVariant(case1, '1', 100, 'A', 'G')
    summaryService.rebuild()

    summaryService.incrementalRemove(case1)

    const row = db
      .prepare("SELECT * FROM cohort_variant_summary WHERE chr = '1' AND pos = 100")
      .get()
    expect(row).toBeUndefined() // removed because carrier_count dropped to 0
  })
})

describe('Rebuild with annotation flags', () => {
  let db: Database.Database
  let summaryService: CohortSummaryService

  const insertCase = (name: string): number => {
    return db
      .prepare(
        'INSERT INTO cases (name, file_path, file_size, variant_count, created_at) VALUES (?, ?, ?, ?, ?)'
      )
      .run(name, `/test/${name}.json`, 1000, 0, Date.now()).lastInsertRowid as number
  }

  const insertVariant = (
    caseId: number,
    chr: string,
    pos: number,
    ref: string,
    alt: string
  ): number => {
    return db
      .prepare(
        'INSERT INTO variants (case_id, chr, pos, ref, alt, gene_symbol, gt_num) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      .run(caseId, chr, pos, ref, alt, 'BRCA1', '0/1').lastInsertRowid as number
  }

  beforeEach(() => {
    db = new Database(':memory:')
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    initializeSchema(db)
    runMigrations(db)
    summaryService = new CohortSummaryService(db)
  })

  afterEach(() => {
    db.close()
  })

  it('should populate annotation flags and cohort_frequency during rebuild', () => {
    const caseId = insertCase('test')
    insertVariant(caseId, '1', 100, 'A', 'G')
    insertVariant(caseId, '1', 200, 'C', 'T')

    // Star one variant globally
    db.prepare(
      `INSERT INTO variant_annotations (chr, pos, ref, alt, starred, global_comment, created_at, updated_at)
       VALUES ('1', 100, 'A', 'G', 1, 'test comment', 0, 0)`
    ).run()

    summaryService.rebuild()

    const starred = db
      .prepare(
        "SELECT has_star, has_comment, cohort_frequency FROM cohort_variant_summary WHERE chr = '1' AND pos = 100"
      )
      .get() as { has_star: number; has_comment: number; cohort_frequency: number }

    expect(starred.has_star).toBe(1)
    expect(starred.has_comment).toBe(1)
    expect(starred.cohort_frequency).toBeCloseTo(1.0) // 1 carrier / 1 case

    const unstarred = db
      .prepare(
        "SELECT has_star, has_comment, cohort_frequency FROM cohort_variant_summary WHERE chr = '1' AND pos = 200"
      )
      .get() as { has_star: number; has_comment: number; cohort_frequency: number }

    expect(unstarred.has_star).toBe(0)
    expect(unstarred.has_comment).toBe(0)
    expect(unstarred.cohort_frequency).toBeCloseTo(1.0)
  })
})
