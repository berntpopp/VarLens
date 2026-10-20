import { describe, it, expect, beforeEach, vi } from 'vitest'
import Database from 'better-sqlite3-multiple-ciphers'
import { AnnotationRepository } from '../../../src/main/database/AnnotationRepository'
import { createKysely } from '../../../src/main/database/kysely'
import { InvalidParametersError } from '../../../src/main/ipc/errors'

describe('AnnotationRepository.getBatch — call-count guarantee (Sprint A A1)', () => {
  let db: Database.Database
  let repo: AnnotationRepository
  const prepareSpy = vi.fn()

  beforeEach(() => {
    db = new Database(':memory:')
    // Minimal schema to satisfy the queries. Read the v29 migration tail
    // (variants + variant_annotations + case_variant_annotations) for the
    // exact columns. Truncated here for plan brevity; the implementer copies
    // the relevant CREATE TABLE statements from src/main/database/migrations.ts.
    db.exec(`
      CREATE TABLE cases (id INTEGER PRIMARY KEY, name TEXT, genome_build TEXT DEFAULT 'GRCh38');
      CREATE TABLE variants (
        id INTEGER PRIMARY KEY,
        case_id INTEGER,
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
        case_id INTEGER, variant_id INTEGER,
        starred INTEGER DEFAULT 0,
        comment TEXT,
        per_case_comment TEXT,
        acmg_classification TEXT,
        acmg_evidence TEXT,
        created_at INTEGER,
        updated_at INTEGER,
        acmg_class TEXT,
        UNIQUE(case_id, variant_id)
      );
      CREATE TABLE tags (id INTEGER PRIMARY KEY, name TEXT);
      CREATE TABLE variant_tags (
        case_id INTEGER, variant_id INTEGER, tag_id INTEGER REFERENCES tags(id), created_at INTEGER,
        PRIMARY KEY (case_id, variant_id, tag_id)
      );
      CREATE INDEX idx_variants_chr_pos_ref_alt ON variants(chr, pos, ref, alt);
      PRAGMA foreign_keys = ON;
    `)

    // Build the Kysely instance BEFORE wrapping db.prepare so its construction
    // never pollutes the prepare-count assertions (it shares the same handle).
    const kysely = createKysely(db)

    // Wrap db.prepare so we can count statement preparations. A1's invariant:
    // exactly 2 prepares per getBatch invocation (one global, one per-case)
    // when caseId !== null; exactly 1 when caseId === null.
    const realPrepare = db.prepare.bind(db)
    db.prepare = ((sql: string) => {
      prepareSpy(sql)
      return realPrepare(sql)
    }) as typeof db.prepare

    // Seed: 1 case + 50 variants + 50 per-case annotations.
    db.exec("INSERT INTO cases (id, name) VALUES (1, 'C1')")
    const insertVariant = realPrepare(
      'INSERT INTO variants (id, case_id, chr, pos, ref, alt) VALUES (?, 1, ?, ?, ?, ?)'
    )
    const insertCva = realPrepare(
      'INSERT INTO case_variant_annotations (case_id, variant_id, starred) VALUES (1, ?, 1)'
    )
    for (let i = 0; i < 50; i++) {
      insertVariant.run(i + 1, 'chr1', 10000 + i, 'A', 'G')
      insertCva.run(i + 1)
    }

    repo = new AnnotationRepository(db, kysely)
    prepareSpy.mockClear()
  })

  it('runs exactly 1 prepared statement when caseId === null (global only)', () => {
    const keys = Array.from({ length: 50 }, (_, i) => ({
      chr: 'chr1',
      pos: 10000 + i,
      ref: 'A',
      alt: 'G'
    }))
    repo.getBatch(null, keys)
    expect(prepareSpy.mock.calls.length).toBe(1)
  })

  it('runs exactly 2 prepared statements when caseId !== null (global + per-case)', () => {
    const keys = Array.from({ length: 50 }, (_, i) => ({
      chr: 'chr1',
      pos: 10000 + i,
      ref: 'A',
      alt: 'G',
      variantId: i + 1
    }))
    repo.getBatch(1, keys)
    expect(prepareSpy.mock.calls.length).toBe(2)
  })

  it('returns a coordinate-keyed map matching the IPC contract shape', () => {
    const keys = Array.from({ length: 3 }, (_, i) => ({
      chr: 'chr1',
      pos: 10000 + i,
      ref: 'A',
      alt: 'G',
      variantId: i + 1
    }))
    const result = repo.getBatch(1, keys)
    expect(Object.keys(result).sort()).toEqual([
      'chr1:10000:A:G',
      'chr1:10001:A:G',
      'chr1:10002:A:G'
    ])
    expect(result['chr1:10000:A:G']).toEqual({
      global: null,
      perCase: expect.objectContaining({ starred: 1 })
    })
  })

  it('ignores a renderer-spoofed variantId pointing to another case', () => {
    // Pass-8 #2 defensive-join check: variantId 1 actually belongs to case 1.
    // If we lie and pass caseId=999, the join through `variants`
    // (variants.case_id = caseId AND variants.id = variantId) must fail to match.
    db.exec("INSERT INTO cases (id, name) VALUES (999, 'Other')")
    // Adversarial fixture: seed a CVA row keyed on case 999 + variant_id 1.
    // Variant id 1 belongs to case 1, NOT case 999. A naive implementation that
    // filters CVA by case_id=999 alone (trusting the spoofed variantId) would
    // match THIS row and wrongly return perCase != null. Only an implementation
    // that joins through `variants` on (variants.case_id = caseId AND
    // variants.id = variantId) correctly excludes it and returns null.
    db.exec(
      'INSERT INTO case_variant_annotations (case_id, variant_id, starred) VALUES (999, 1, 1)'
    )
    const keys = [{ chr: 'chr1', pos: 10000, ref: 'A', alt: 'G', variantId: 1 }]
    const result = repo.getBatch(999, keys)
    expect(result['chr1:10000:A:G']).toEqual({ global: null, perCase: null })
  })

  it('prevents per-case annotation collision across duplicate-coordinate rows (#623)', () => {
    const v1 = 1001
    const v2 = 1002
    db.prepare(
      'INSERT INTO variants (id, case_id, chr, pos, ref, alt) VALUES (?, 1, ?, ?, ?, ?)'
    ).run(v1, 'chr2', 20000, 'C', 'T')
    db.prepare(
      'INSERT INTO variants (id, case_id, chr, pos, ref, alt) VALUES (?, 1, ?, ?, ?, ?)'
    ).run(v2, 'chr2', 20000, 'C', 'T')

    // Scenario A: only the first variant has a case_variant_annotations record
    db.prepare(
      'INSERT INTO case_variant_annotations (case_id, variant_id, starred, comment) VALUES (1, ?, 1, ?)'
    ).run(v1, 'first-annotated')

    let res = repo.getBatch(1, [
      { chr: 'chr2', pos: 20000, ref: 'C', alt: 'T', variantId: v1 },
      { chr: 'chr2', pos: 20000, ref: 'C', alt: 'T', variantId: v2 }
    ])
    expect(res['chr2:20000:C:T'].perCase).toEqual(
      expect.objectContaining({ variant_id: v1, starred: 1, comment: 'first-annotated' })
    )

    res = repo.getBatch(1, [{ chr: 'chr2', pos: 20000, ref: 'C', alt: 'T' }])
    expect(res['chr2:20000:C:T'].perCase).toEqual(
      expect.objectContaining({ variant_id: v1, starred: 1, comment: 'first-annotated' })
    )

    // Clear annotation and test Scenario B: only the second variant has a record
    db.prepare('DELETE FROM case_variant_annotations WHERE case_id = 1 AND variant_id = ?').run(v1)
    db.prepare(
      'INSERT INTO case_variant_annotations (case_id, variant_id, starred, comment) VALUES (1, ?, 1, ?)'
    ).run(v2, 'second-annotated')

    res = repo.getBatch(1, [
      { chr: 'chr2', pos: 20000, ref: 'C', alt: 'T', variantId: v1 },
      { chr: 'chr2', pos: 20000, ref: 'C', alt: 'T', variantId: v2 }
    ])
    expect(res['chr2:20000:C:T'].perCase).toEqual(
      expect.objectContaining({ variant_id: v2, starred: 1, comment: 'second-annotated' })
    )

    res = repo.getBatch(1, [{ chr: 'chr2', pos: 20000, ref: 'C', alt: 'T' }])
    expect(res['chr2:20000:C:T'].perCase).toEqual(
      expect.objectContaining({ variant_id: v2, starred: 1, comment: 'second-annotated' })
    )
  })

  it('prefers matching variantId when multiple annotated rows share coordinates (#623)', () => {
    const v1 = 2001
    const v2 = 2002
    db.prepare(
      'INSERT INTO variants (id, case_id, chr, pos, ref, alt) VALUES (?, 1, ?, ?, ?, ?)'
    ).run(v1, 'chr3', 30000, 'A', 'C')
    db.prepare(
      'INSERT INTO variants (id, case_id, chr, pos, ref, alt) VALUES (?, 1, ?, ?, ?, ?)'
    ).run(v2, 'chr3', 30000, 'A', 'C')
    db.prepare(
      'INSERT INTO case_variant_annotations (case_id, variant_id, starred, comment) VALUES (1, ?, 1, ?)'
    ).run(v1, 'v1-note')
    db.prepare(
      'INSERT INTO case_variant_annotations (case_id, variant_id, starred, comment) VALUES (1, ?, 0, ?)'
    ).run(v2, 'v2-note')

    const res1 = repo.getBatch(1, [{ chr: 'chr3', pos: 30000, ref: 'A', alt: 'C', variantId: v1 }])
    expect(res1['chr3:30000:A:C'].perCase).toEqual(
      expect.objectContaining({ variant_id: v1, comment: 'v1-note' })
    )

    const res2 = repo.getBatch(1, [{ chr: 'chr3', pos: 30000, ref: 'A', alt: 'C', variantId: v2 }])
    expect(res2['chr3:30000:A:C'].perCase).toEqual(
      expect.objectContaining({ variant_id: v2, comment: 'v2-note' })
    )
  })

  describe('batchUpsertPerCaseAnnotation — atomic transactions & rollback', () => {
    it('deduplicates variant IDs and returns updated count', () => {
      const res = repo.batchUpsertPerCaseAnnotation(1, [1, 1, 2, 2], { starred: true })
      expect(res.updatedCount).toBe(2)
    })

    it('rejects when variants do not belong to case and performs atomic rollback', () => {
      let thrown: unknown
      try {
        repo.batchUpsertPerCaseAnnotation(1, [1, 99999], {
          starred: false,
          per_case_comment: 'mutated comment'
        })
      } catch (err) {
        thrown = err
      }
      expect(thrown).toBeInstanceOf(InvalidParametersError)
      expect((thrown as Error).message).toMatch(/do not belong to case 1/)

      // Variant 1's annotation remains unchanged from seed (starred = 1, per_case_comment = null)
      const row = db
        .prepare(
          'SELECT starred, per_case_comment FROM case_variant_annotations WHERE variant_id = 1'
        )
        .get() as { starred: number; per_case_comment: string | null }
      expect(row.starred).toBe(1)
      expect(row.per_case_comment).toBeNull()
    })

    it('rolls back mid-write on foreign key violation leaving 0 new rows', () => {
      // Seed two fresh variants 60 and 61 with no existing annotations or tags
      db.prepare(
        'INSERT INTO variants (id, case_id, chr, pos, ref, alt) VALUES (?, 1, ?, ?, ?, ?)'
      ).run(60, 'chr4', 40000, 'A', 'T')
      db.prepare(
        'INSERT INTO variants (id, case_id, chr, pos, ref, alt) VALUES (?, 1, ?, ?, ?, ?)'
      ).run(61, 'chr4', 40001, 'G', 'C')

      // Attempt to batch-upsert [1, 60, 61] (mutating variant 1's starred=1 -> false and per_case_comment)
      // with non-existent tag_id 999999 under PRAGMA foreign_keys = ON
      let thrown: unknown
      try {
        repo.batchUpsertPerCaseAnnotation(1, [1, 60, 61], {
          starred: false,
          per_case_comment: 'test comment',
          tag_id: 999999
        })
      } catch (err) {
        thrown = err
      }
      expect(thrown).toBeInstanceOf(Error)
      expect((thrown as Error).message).toBe('Transaction failed')
      expect((thrown as { cause?: Error }).cause?.message).toMatch(/FOREIGN KEY constraint failed/)

      // Verify transaction rollback: variant 1's mutation was rolled back
      const v1Row = db
        .prepare(
          'SELECT starred, per_case_comment FROM case_variant_annotations WHERE variant_id = 1'
        )
        .get() as { starred: number; per_case_comment: string | null }
      expect(v1Row.starred).toBe(1)
      expect(v1Row.per_case_comment).toBeNull()

      // And 0 rows inserted into case_variant_annotations or variant_tags for 60, 61
      const cvaCount = db
        .prepare(
          'SELECT count(*) as count FROM case_variant_annotations WHERE variant_id IN (60, 61)'
        )
        .get() as { count: number }
      expect(cvaCount.count).toBe(0)

      const tagCount = db
        .prepare('SELECT count(*) as count FROM variant_tags WHERE variant_id IN (1, 60, 61)')
        .get() as { count: number }
      expect(tagCount.count).toBe(0)
    })
  })
})
