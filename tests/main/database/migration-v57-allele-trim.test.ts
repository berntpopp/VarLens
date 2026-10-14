/**
 * Migration v57 (#587, mirrors PG 0040): rows imported before allele trimming
 * get the minimal alleles an import stores now; global annotations on both
 * spellings merge, and every dropped value is in audit_log.
 */
import Database from 'better-sqlite3-multiple-ciphers'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  ALLELE_TRIM_MIGRATION_USER,
  TRIM_PAGE_SIZE
} from '../../../src/shared/genome/allele-trim-plan'
import { LATEST_SQLITE_SCHEMA_VERSION, runMigrations } from '../../../src/main/database/migrations'
import { initializeSchema } from '../../../src/main/database/schema'
import { rebuildCohortSummary } from '../../../src/main/workers/worker-db'

describe('migration v57: minimal alleles for rows imported before #587', () => {
  let db: InstanceType<typeof Database>

  beforeEach(() => {
    db = new Database(':memory:')
    initializeSchema(db)
    runMigrations(db)
    // Case 1 was imported before #587 (padded spellings); case 2 after.
    db.exec(`
      INSERT INTO cases (id, name, file_path, file_size, variant_count, created_at, genome_build)
        VALUES (1, 'old', '/a', 1, 4, 0, 'GRCh38'), (2, 'new', '/b', 1, 1, 0, 'GRCh38');
      INSERT INTO variants (case_id, chr, pos, ref, alt, gt_num, variant_type) VALUES
        (1, 'chr5', 100, 'ATT', 'AT', '0/1', 'indel'),
        (1, 'chr5', 100, 'AT', 'A', '1/1', 'indel'),
        (1, 'chr5', 200, 'ACG', 'ATG', '0/1', 'indel'),
        (1, 'chr5', 300, 'CAGCAACAG', 'CAGCAGCAG', '0/1', 'str'),
        (2, 'chr5', 100, 'AT', 'A', '0/1', 'indel');
      INSERT INTO variant_annotations (chr, pos, ref, alt, genome_build, global_comment, starred,
        acmg_classification, acmg_evidence, created_at, updated_at) VALUES
        ('chr5', 100, 'ATT', 'AT', 'GRCh38', 'old note', 1, 'Pathogenic', '{"old":1}', 5, 10),
        ('chr5', 100, 'AT', 'A', 'GRCh38', 'new note', 0, 'Likely benign', '{"new":1}', 15, 20),
        ('chr5', 200, 'ACG', 'ATG', 'GRCh38', 'snv note', 0, NULL, NULL, 1, 1),
        ('chr5', 300, 'CAGCAACAG', 'CAGCAGCAG', 'GRCh38', 'str note', 0, NULL, NULL, 1, 1);
      PRAGMA user_version = 54;
    `)
  })

  afterEach(() => db.close())

  const variants = () =>
    db.prepare('SELECT case_id, pos, ref, alt, variant_type FROM variants ORDER BY id').all()
  const annotations = () =>
    db
      .prepare(
        `SELECT pos, ref, alt, global_comment, starred, acmg_classification, acmg_evidence,
                created_at, updated_at FROM variant_annotations ORDER BY pos`
      )
      .all()
  const audits = () =>
    db
      .prepare(
        'SELECT action_type, entity_key, old_value, new_value, user_name FROM audit_log ORDER BY id'
      )
      .all()

  it('trims small variants like the import; STR rows keep their alleles', () => {
    runMigrations(db)
    expect(db.pragma('user_version', { simple: true })).toBe(LATEST_SQLITE_SCHEMA_VERSION)
    expect(variants()).toEqual([
      { case_id: 1, pos: 100, ref: 'AT', alt: 'A', variant_type: 'indel' },
      // Two rows of one case on one key both stay (the summary counts the case once).
      { case_id: 1, pos: 100, ref: 'AT', alt: 'A', variant_type: 'indel' },
      { case_id: 1, pos: 201, ref: 'C', alt: 'T', variant_type: 'snv' },
      { case_id: 1, pos: 300, ref: 'CAGCAACAG', alt: 'CAGCAGCAG', variant_type: 'str' },
      { case_id: 2, pos: 100, ref: 'AT', alt: 'A', variant_type: 'indel' }
    ])
  })

  it('merges the annotations of both spellings and audits the dropped call', () => {
    runMigrations(db)
    expect(annotations()).toEqual([
      {
        pos: 100,
        ref: 'AT',
        alt: 'A',
        global_comment: 'old note\n\nnew note',
        starred: 1,
        acmg_classification: 'Likely benign',
        acmg_evidence: '{"new":1}',
        created_at: 5,
        updated_at: 20
      },
      expect.objectContaining({ pos: 201, ref: 'C', alt: 'T', global_comment: 'snv note' }),
      expect.objectContaining({ pos: 300, ref: 'CAGCAACAG', global_comment: 'str note' })
    ])
    expect(audits()).toEqual([
      {
        action_type: 'acmg_classify',
        entity_key: 'chr5:100:AT:A@GRCh38',
        old_value: JSON.stringify({ acmg_classification: 'Pathogenic' }),
        new_value: JSON.stringify({
          acmg_classification: 'Likely benign',
          reason: 'allele_trim of chr5:100:ATT:AT, chr5:100:AT:A'
        }),
        user_name: ALLELE_TRIM_MIGRATION_USER
      },
      {
        action_type: 'acmg_evidence_update',
        entity_key: 'chr5:100:AT:A@GRCh38',
        old_value: JSON.stringify({ acmg_evidence: '{"old":1}' }),
        new_value: JSON.stringify({ acmg_evidence: '{"new":1}' }),
        user_name: ALLELE_TRIM_MIGRATION_USER
      }
    ])
  })

  it('flags the summary stale; the rebuild counts old and new carriers on one key', () => {
    db.exec(`INSERT INTO cohort_variant_summary
      (chr, pos, ref, alt, variant_type, genome_build, variant_key, carrier_count, het_count, hom_count)
      VALUES ('chr5', 100, 'ATT', 'AT', 'indel', 'GRCh38', 'k', 1, 1, 0)`)
    db.exec("DELETE FROM cohort_summary_meta WHERE key = 'is_stale'")
    runMigrations(db)
    expect(
      db.prepare("SELECT value FROM cohort_summary_meta WHERE key = 'is_stale'").pluck().get()
    ).toBe('1')
    rebuildCohortSummary(db)
    expect(
      db
        .prepare(
          `SELECT pos, ref, alt, carrier_count, acmg_best, has_star FROM cohort_variant_summary
            WHERE pos = 100`
        )
        .all()
    ).toEqual([
      { pos: 100, ref: 'AT', alt: 'A', carrier_count: 2, acmg_best: 'Likely benign', has_star: 1 }
    ])
  })

  it('trims every page of a large table', () => {
    const rows = 2 * TRIM_PAGE_SIZE + 5
    db.exec(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ${rows})
      INSERT INTO variants (case_id, chr, pos, ref, alt, gt_num, variant_type)
      SELECT 2, 'chr9', i * 10, 'GCC', 'GC', '0/1', 'indel' FROM n`)
    runMigrations(db)
    expect(
      db
        .prepare("SELECT ref, alt, COUNT(*) AS n FROM variants WHERE chr = 'chr9' GROUP BY 1, 2")
        .all()
    ).toEqual([{ ref: 'GC', alt: 'G', n: rows }])
  })

  it('is idempotent: a second run changes and audits nothing', () => {
    runMigrations(db)
    const [v, a, l] = [variants(), annotations(), audits()]
    db.exec('PRAGMA user_version = 54')
    runMigrations(db)
    expect([variants(), annotations(), audits()]).toEqual([v, a, l])
  })
})
