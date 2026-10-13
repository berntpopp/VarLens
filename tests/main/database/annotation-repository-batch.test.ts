import { describe, it, expect, beforeEach, vi } from 'vitest'
import Database from 'better-sqlite3-multiple-ciphers'
import { AnnotationRepository } from '../../../src/main/database/AnnotationRepository'
import { createKysely } from '../../../src/main/database/kysely'

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
        acmg_class TEXT,
        UNIQUE(case_id, variant_id)
      );
      CREATE INDEX idx_variants_chr_pos_ref_alt ON variants(chr, pos, ref, alt);
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
})
