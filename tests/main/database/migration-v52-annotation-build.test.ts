/**
 * Migration v52 (#577, mirrors PG 0035): global annotations are keyed by
 * genome build. Shared rows are copied to every build that uses them, never
 * moved; afterwards a GRCh37 and a GRCh38 case at the same coordinates have
 * independent ACMG calls and comments.
 */
import Database from 'better-sqlite3-multiple-ciphers'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { AnnotationRepository } from '../../../src/main/database/AnnotationRepository'
import { resolveBuildReviews } from '../../../src/main/database/contig-rename-sqlite'
import { CONTIG_BUILD_REVIEW_DDL } from '../../../src/main/database/contig-naming-migration'
import { createKysely } from '../../../src/main/database/kysely'
import { runMigrations } from '../../../src/main/database/migrations'
import { initializeSchema } from '../../../src/main/database/schema'

const NOTE = `'note', 1, 'Pathogenic', '{"is_override":false}', 10, 20`

describe('migration v52: global annotations keyed by genome build', () => {
  let db: InstanceType<typeof Database>

  beforeEach(() => {
    db = new Database(':memory:')
    initializeSchema(db)
    runMigrations(db)
  })

  afterEach(() => db.close())

  /** The v51 shape: one global row per chr:pos:ref:alt, whatever the build. */
  function backToV51(): void {
    db.exec(`
      DROP TABLE variant_annotations;
      CREATE TABLE variant_annotations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chr TEXT NOT NULL, pos INTEGER NOT NULL, ref TEXT NOT NULL, alt TEXT NOT NULL,
        global_comment TEXT, starred INTEGER NOT NULL DEFAULT 0,
        acmg_classification TEXT, acmg_evidence TEXT,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
        UNIQUE(chr, pos, ref, alt)
      );
      INSERT INTO cases (id, name, file_path, file_size, variant_count, created_at, genome_build)
        VALUES (1, 'b37', '/a', 1, 2, 0, 'GRCh37'), (2, 'b38', '/b', 1, 1, 0, 'GRCh38');
      INSERT INTO variants (case_id, chr, pos, ref, alt) VALUES
        (1, 'chrUn_x', 100, 'A', 'G'), (2, 'chrUn_x', 100, 'A', 'G'), (1, 'chrUn_x', 5, 'C', 'T');
      INSERT INTO variant_annotations (chr, pos, ref, alt, global_comment, starred,
        acmg_classification, acmg_evidence, created_at, updated_at) VALUES
        ('chrUn_x', 100, 'A', 'G', ${NOTE}),
        ('chrUn_x', 5, 'C', 'T', ${NOTE}),
        ('chrUn_x', 7, 'G', 'A', ${NOTE});
      PRAGMA user_version = 51;
    `)
  }

  const rowsAt = (pos: number) =>
    db
      .prepare(
        `SELECT genome_build, global_comment, starred, acmg_classification, acmg_evidence,
                created_at, updated_at
           FROM variant_annotations WHERE pos = ? ORDER BY genome_build`
      )
      .all(pos)

  const copy = (genome_build: string) => ({
    genome_build,
    global_comment: 'note',
    starred: 1,
    acmg_classification: 'Pathogenic',
    acmg_evidence: '{"is_override":false}',
    created_at: 10,
    updated_at: 20
  })

  it('copies a shared row to every build that holds the coordinate', () => {
    backToV51()
    runMigrations(db)
    expect(db.pragma('user_version', { simple: true })).toBeGreaterThanOrEqual(52)
    expect(rowsAt(100)).toEqual([copy('GRCh37'), copy('GRCh38')])
  })

  it('keeps a row of one build in that build only', () => {
    backToV51()
    runMigrations(db)
    expect(rowsAt(5)).toEqual([copy('GRCh37')])
  })

  it('keeps a row no case uses, in every build present (nothing is lost)', () => {
    backToV51()
    runMigrations(db)
    expect(rowsAt(7)).toEqual([copy('GRCh37'), copy('GRCh38')])
  })

  it('gives GRCh37 and GRCh38 cases independent calls and comments afterwards', () => {
    backToV51()
    runMigrations(db)
    const repo = new AnnotationRepository(db, createKysely(db))
    repo.upsertGlobalAnnotation('chrUn_x', 100, 'A', 'G', 'GRCh38', {
      acmg_classification: 'Benign',
      global_comment: 'b38 only'
    })
    const b37 = repo.getAnnotationsForVariant(1, 'chrUn_x', 100, 'A', 'G').global
    const b38 = repo.getAnnotationsForVariant(2, 'chrUn_x', 100, 'A', 'G').global
    expect(b37).toMatchObject({ acmg_classification: 'Pathogenic', global_comment: 'note' })
    expect(b38).toMatchObject({ acmg_classification: 'Benign', global_comment: 'b38 only' })

    const key = [{ chr: 'chrUn_x', pos: 100, ref: 'A', alt: 'G' }]
    expect(repo.getBatch(1, key)['chrUn_x:100:A:G'].global?.genome_build).toBe('GRCh37')
    expect(repo.getBatch(null, key, 'GRCh38')['chrUn_x:100:A:G'].global?.global_comment).toBe(
      'b38 only'
    )
    // Without a case or a build no global row is served.
    expect(repo.getBatch(null, key)['chrUn_x:100:A:G'].global).toBeNull()
  })

  it('updates the cohort summary flags of the annotation build only', () => {
    backToV51()
    runMigrations(db)
    db.exec(`
      INSERT INTO cohort_variant_summary
        (chr, pos, ref, alt, variant_type, genome_build, variant_key, carrier_count, het_count, hom_count)
      VALUES ('chrUn_x', 100, 'A', 'G', 'snv', 'GRCh37', 'k', 1, 1, 0),
             ('chrUn_x', 100, 'A', 'G', 'snv', 'GRCh38', 'k', 1, 1, 0)`)
    const repo = new AnnotationRepository(db, createKysely(db))
    repo.upsertGlobalAnnotation('chrUn_x', 100, 'A', 'G', 'GRCh38', {
      acmg_classification: 'Benign',
      starred: 0
    })
    repo.deleteGlobalAnnotation('chrUn_x', 100, 'A', 'G', 'GRCh37')
    expect(
      db
        .prepare(
          'SELECT genome_build, has_star, acmg_best FROM cohort_variant_summary ORDER BY genome_build'
        )
        .all()
    ).toEqual([
      { genome_build: 'GRCh37', has_star: 0, acmg_best: null },
      { genome_build: 'GRCh38', has_star: 0, acmg_best: 'Benign' }
    ])
  })

  it('a case confirmed in another build takes a copy of its notes along', () => {
    backToV51()
    runMigrations(db)
    db.exec(CONTIG_BUILD_REVIEW_DDL)
    db.exec(`INSERT INTO contig_build_review (case_id, stored_build, reason, created_at)
             VALUES (1, 'GRCh37', 'no_evidence', 0)`)
    resolveBuildReviews(db, [{ caseId: 1, build: 'GRCh38' }])
    // 5 was GRCh37-only: now in both; 100 already had a GRCh38 row, which is kept.
    expect(rowsAt(5)).toEqual([copy('GRCh37'), copy('GRCh38')])
    expect(rowsAt(100)).toEqual([copy('GRCh37'), copy('GRCh38')])
  })

  it('normalises stored build aliases before the split; flags unknown ones', () => {
    backToV51()
    db.exec(`
      UPDATE cases SET genome_build = 'hg19' WHERE id = 1;
      INSERT INTO cases (id, name, file_path, file_size, variant_count, created_at, genome_build)
        VALUES (3, 'odd', '/c', 1, 0, 0, 'my-build');
      INSERT INTO variants (case_id, chr, pos, ref, alt) VALUES (3, 'chrUn_x', 9, 'A', 'G');
      INSERT INTO variant_annotations (chr, pos, ref, alt, global_comment, starred,
        acmg_classification, acmg_evidence, created_at, updated_at)
        VALUES ('chrUn_x', 9, 'A', 'G', ${NOTE});
      PRAGMA user_version = 51;`)
    runMigrations(db)
    expect(db.prepare('SELECT id, genome_build FROM cases ORDER BY id').all()).toEqual([
      { id: 1, genome_build: 'GRCh37' },
      { id: 2, genome_build: 'GRCh38' },
      { id: 3, genome_build: 'my-build' }
    ])
    expect(rowsAt(5)).toEqual([copy('GRCh37')]) // split under the canonical build
    expect(rowsAt(9)).toEqual([copy('my-build')]) // kept, under the value as stored
    expect(
      db.prepare('SELECT case_id, stored_build, reason FROM contig_build_review').all()
    ).toEqual([{ case_id: 3, stored_build: 'my-build', reason: 'build_unknown' }])
  })

  it('a fresh database has the build in the key', () => {
    const repo = new AnnotationRepository(db, createKysely(db))
    repo.upsertGlobalAnnotation('1', 1, 'A', 'G', 'GRCh37', { global_comment: 'x' })
    repo.upsertGlobalAnnotation('1', 1, 'A', 'G', 'GRCh38', { global_comment: 'y' })
    expect(db.prepare('SELECT COUNT(*) AS n FROM variant_annotations').get()).toEqual({ n: 2 })
  })
})
