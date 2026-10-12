/**
 * Migration v47: chromosome names in each build's reference form
 * (.planning/specs/2026-10-12-chr-naming-per-build.md).
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3-multiple-ciphers'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  migrateContigNaming,
  renameCaseContigs
} from '../../../src/main/database/contig-naming-migration'
import { runMigrations } from '../../../src/main/database/migrations'
import { initializeSchema } from '../../../src/main/database/schema'
import { VariantFrequencyService } from '../../../src/main/database/VariantFrequencyService'

type Db = InstanceType<typeof Database>

const GRCH38_HEADER = '##fileformat=VCFv4.2\n##contig=<ID=1,length=248956422>\n#CHROM\tPOS\n'
const GRCH37_TAG = '##fileformat=VCFv4.2\n##reference=file:///ref/hs37d5.fa\n#CHROM\tPOS\n'

describe('migration v47: chromosome names per build', () => {
  let db: Db
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'v46-'))
    db = new Database(':memory:')
    initializeSchema(db)
    runMigrations(db)
  })
  afterEach(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  function addCase(name: string, build: string, header: string | null): number {
    let path = join(dir, `${name}.json`)
    if (header !== null) {
      path = join(dir, `${name}.vcf`)
      writeFileSync(path, header)
    }
    return Number(
      db
        .prepare(
          `INSERT INTO cases (name, file_path, file_size, variant_count, created_at, genome_build, import_status)
           VALUES (?, ?, 0, 0, 0, ?, 'ready')`
        )
        .run(name, path, build).lastInsertRowid
    )
  }
  function addVariant(caseId: number, chr: string, pos: number, ref = 'A', alt = 'G'): void {
    db.prepare('INSERT INTO variants (case_id, chr, pos, ref, alt) VALUES (?, ?, ?, ?, ?)').run(
      caseId,
      chr,
      pos,
      ref,
      alt
    )
  }
  function annotate(
    chr: string,
    pos: number,
    over: { comment?: string; starred?: number; acmg?: string; updated?: number } = {}
  ): void {
    db.prepare(
      `INSERT INTO variant_annotations (chr, pos, ref, alt, global_comment, starred, acmg_classification, created_at, updated_at)
       VALUES (?, ?, 'A', 'G', ?, ?, ?, 0, ?)`
    ).run(chr, pos, over.comment ?? null, over.starred ?? 0, over.acmg ?? null, over.updated ?? 1)
  }
  const chrsOf = (caseId: number): string[] =>
    (
      db
        .prepare('SELECT DISTINCT chr FROM variants WHERE case_id = ? ORDER BY chr')
        .all(caseId) as Array<{
        chr: string
      }>
    ).map((r) => r.chr)
  const annotation = (chr: string, pos: number) =>
    db
      .prepare(
        'SELECT global_comment, starred, acmg_classification FROM variant_annotations WHERE chr = ? AND pos = ?'
      )
      .get(chr, pos)
  const snapshot = () => ({
    variants: db.prepare('SELECT id, chr FROM variants ORDER BY id').all(),
    annotations: db.prepare('SELECT * FROM variant_annotations ORDER BY id').all(),
    frequency: db.prepare('SELECT * FROM variant_frequency ORDER BY chr, pos').all(),
    reviews: db.prepare('SELECT case_id, reason FROM contig_build_review ORDER BY case_id').all()
  })

  /** A mixed-build database with every migration path. */
  function seed() {
    const a = addCase('A', 'GRCh38', GRCH38_HEADER) // confirmed GRCh38, bare names
    const b = addCase('B', 'GRCh37', GRCH37_TAG) // confirmed GRCh37, chr names + hg19 chrM
    const c = addCase('C', 'GRCh38', null) // no evidence: flagged, untouched
    const d = addCase('D', 'GRCh38', null) // already canonical
    const e = addCase('E', 'GRCh37', null) // already canonical GRCh37
    for (const pos of [100, 200, 300]) addVariant(a, '1', pos)
    addVariant(a, 'MT', 50)
    addVariant(a, 'chrUn_KI270742v1', 5)
    addVariant(b, 'chr1', 400)
    addVariant(b, 'chrM', 60)
    addVariant(c, '1', 100)
    addVariant(d, 'chr1', 100)
    addVariant(e, '1', 200)
    for (const id of [a, b, c, d, e]) new VariantFrequencyService(db).updateFrequencies(id)
    // Collision at chr1:100 (A renames 1 → chr1, D holds chr1); C still uses 1:100.
    annotate('1', 100, { comment: 'a', starred: 1, acmg: 'Benign', updated: 1 })
    annotate('chr1', 100, { comment: 'b', acmg: 'Pathogenic', updated: 2 })
    annotate('1', 200, { comment: 'shared with GRCh37 E' })
    annotate('1', 300, { comment: 'only A' })
    return { a, b, c, d, e }
  }

  it('renames confirmed cases, flags the rest and merges colliding annotations', () => {
    const { a, b, c, d, e } = seed()
    const backup = vi.fn()
    migrateContigNaming(db, backup)

    expect(backup).toHaveBeenCalledTimes(1)
    expect(chrsOf(a)).toEqual(['chr1', 'chrM', 'chrUn_KI270742v1'])
    expect(chrsOf(b)).toEqual(['1', 'chrM']) // hg19 chrM is never merged with MT
    expect(chrsOf(c)).toEqual(['1'])
    expect(chrsOf(d)).toEqual(['chr1'])
    expect(chrsOf(e)).toEqual(['1'])
    expect(
      db
        .prepare('SELECT case_id, stored_build, suggested_build, reason FROM contig_build_review')
        .all()
    ).toEqual([
      { case_id: c, stored_build: 'GRCh38', suggested_build: null, reason: 'no_evidence' }
    ])

    expect(annotation('chr1', 100)).toEqual({
      global_comment: 'b\n\na',
      starred: 1,
      acmg_classification: 'Pathogenic'
    })
    expect(annotation('1', 100)).toMatchObject({ global_comment: 'a' }) // C still uses it
    const audit = db.prepare('SELECT * FROM audit_log').all() as Array<Record<string, string>>
    expect(audit).toHaveLength(1)
    expect(audit[0]).toMatchObject({ action_type: 'acmg_classify', entity_key: 'chr1:100:A:G' })
    expect(JSON.parse(audit[0].old_value)).toEqual({ acmg_classification: 'Benign' })
    expect(annotation('chr1', 200)).toMatchObject({ global_comment: 'shared with GRCh37 E' })
    expect(annotation('1', 200)).toMatchObject({ global_comment: 'shared with GRCh37 E' }) // copied
    expect(annotation('chr1', 300)).toMatchObject({ global_comment: 'only A' })
    expect(annotation('1', 300)).toBeUndefined() // moved

    // Frequencies equal a recount from scratch, and the summary is rebuilt.
    const after = db
      .prepare('SELECT chr, pos, case_count FROM variant_frequency ORDER BY chr, pos')
      .all()
    new VariantFrequencyService(db).recomputeAllFrequencies()
    expect(after).toEqual(
      db.prepare('SELECT chr, pos, case_count FROM variant_frequency ORDER BY chr, pos').all()
    )
    expect(
      db.prepare("SELECT value FROM cohort_summary_meta WHERE key = 'is_stale'").get()
    ).toEqual({ value: '1' })
  })

  it('is idempotent: a second run changes nothing and takes no backup', () => {
    seed()
    migrateContigNaming(db, vi.fn())
    const before = snapshot()
    const backup = vi.fn()
    migrateContigNaming(db, backup)
    expect(snapshot()).toEqual(before)
    expect(backup).not.toHaveBeenCalled()
  })

  it('a database already in reference form is left alone', () => {
    const d = addCase('D', 'GRCh38', null)
    addVariant(d, 'chr1', 1)
    const backup = vi.fn()
    migrateContigNaming(db, backup)
    expect(backup).not.toHaveBeenCalled()
    expect(chrsOf(d)).toEqual(['chr1'])
    expect(db.prepare('SELECT COUNT(*) AS n FROM contig_build_review').get()).toEqual({ n: 0 })
  })

  it('a header naming another build flags the case with that suggestion', () => {
    const x = addCase('X', 'GRCh38', GRCH37_TAG)
    addVariant(x, '1', 5)
    migrateContigNaming(db, vi.fn())
    expect(chrsOf(x)).toEqual(['1'])
    expect(db.prepare('SELECT suggested_build, reason FROM contig_build_review').get()).toEqual({
      suggested_build: 'GRCh37',
      reason: 'build_disagrees'
    })
  })

  it('renameCaseContigs (a confirmed review) applies the same rules to one case', () => {
    const { c } = seed()
    migrateContigNaming(db, vi.fn())
    renameCaseContigs(db, c, [{ from: '1', to: 'chr1' }])
    expect(chrsOf(c)).toEqual(['chr1'])
    expect(annotation('1', 100)).toBeUndefined() // nobody uses 1:100 any more: merged and removed
    expect(annotation('chr1', 100)).toMatchObject({ global_comment: 'b\n\na', starred: 1 })
  })

  it('backs up the database file before renaming', () => {
    db.close()
    const path = join(dir, 'file.db')
    db = new Database(path)
    initializeSchema(db)
    runMigrations(db)
    seed()
    migrateContigNaming(db)
    expect(existsSync(`${path}.pre-v47.bak`)).toBe(true)
    const old = new Database(`${path}.pre-v47.bak`, { readonly: true })
    try {
      expect(old.prepare("SELECT COUNT(*) AS n FROM variants WHERE chr = '1'").get()).toEqual({
        n: 5
      })
    } finally {
      old.close()
    }
  })
})
