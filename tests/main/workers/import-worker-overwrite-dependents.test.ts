// @vitest-environment node
/**
 * The import worker runs with foreign_keys = OFF and deletes a replaced or
 * discarded case by hand. Every row that ON DELETE CASCADE would remove must
 * go with it: a comment, tag or classification of a case that no longer
 * exists must not stay in the database.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3-multiple-ciphers'
import type { Database as DatabaseType } from 'better-sqlite3-multiple-ciphers'
import { randomUUID } from 'node:crypto'
import { rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { runMigrations } from '../../../src/main/database/migrations'
import { initializeSchema } from '../../../src/main/database/schema'
import { runImportSession } from '../../../src/main/workers/import-worker'

describe('import worker: rows that depend on a replaced case', () => {
  let dbPath: string
  let db: DatabaseType

  beforeEach(() => {
    dbPath = join(tmpdir(), `varlens-test-${randomUUID()}.db`)
    db = new Database(dbPath)
    initializeSchema(db)
    runMigrations(db)
  })

  afterEach(() => {
    db.close()
    for (const suffix of ['', '-wal', '-shm']) rmSync(dbPath + suffix, { force: true })
  })

  async function importCase(strategy: 'skip' | 'overwrite'): Promise<void> {
    const filePath = join(tmpdir(), `${randomUUID()}.json`)
    const variant = {
      chr: 'chr1',
      pos: 100,
      ref: 'A',
      alt: 'C',
      gene_symbol: 'GENE',
      gt_num: '0/1'
    }
    writeFileSync(filePath, JSON.stringify({ variants: [variant] }))
    try {
      await runImportSession(
        {
          type: 'start',
          dbPath,
          throttleMs: 0,
          files: [
            {
              filePath,
              caseName: 'patient',
              isDuplicate: strategy === 'overwrite',
              duplicateStrategy: strategy
            }
          ]
        },
        { postMessage: () => undefined }
      )
    } finally {
      unlinkSync(filePath)
    }
  }

  it('an overwrite removes the comment, tag, classification and links of the old case', async () => {
    await importCase('skip')
    const { id: caseId } = db.prepare('SELECT id FROM cases').get() as { id: number }
    const { id: variantId } = db.prepare('SELECT id FROM variants').get() as { id: number }
    db.exec(`
      INSERT INTO case_comments (case_id, category, content, created_at)
        VALUES (${caseId}, 'general', 'index patient', 1);
      INSERT INTO tags (name, color, created_at) VALUES ('review', '#fff', 1);
      INSERT INTO variant_tags (case_id, variant_id, tag_id, created_at)
        VALUES (${caseId}, ${variantId}, (SELECT id FROM tags), 1);
      INSERT INTO case_variant_annotations
          (case_id, variant_id, acmg_classification, starred, created_at, updated_at)
        VALUES (${caseId}, ${variantId}, 'Pathogenic', 1, 1, 1);
      INSERT INTO case_metadata (case_id, created_at, updated_at) VALUES (${caseId}, 1, 1);
      INSERT INTO case_hpo_terms (case_id, hpo_id, hpo_label, created_at)
        VALUES (${caseId}, 'HP:0000001', 'All', 1);
      INSERT INTO case_external_ids (case_id, id_type, id_value, created_at)
        VALUES (${caseId}, 'MRN', '42', 1);
      INSERT INTO cohort_groups (name, created_at) VALUES ('cohort', 1);
      INSERT INTO case_cohort_links (case_id, cohort_id)
        VALUES (${caseId}, (SELECT id FROM cohort_groups));
      INSERT INTO analysis_groups (name, group_type, created_at, updated_at)
        VALUES ('FAM', 'family', 1, 1);
      INSERT INTO analysis_group_members (group_id, case_id, role)
        VALUES ((SELECT id FROM analysis_groups), ${caseId}, 'proband');
    `)

    await importCase('overwrite')

    const replacement = db.prepare('SELECT id, name FROM cases').all() as Array<{ id: number }>
    expect(replacement).toEqual([{ id: expect.any(Number), name: 'patient' }])
    expect(replacement[0].id).not.toBe(caseId)
    // No row anywhere references a case or variant that is gone.
    expect(db.pragma('foreign_key_check')).toEqual([])
    for (const table of ['case_comments', 'variant_tags', 'case_variant_annotations']) {
      expect(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get(), table).toEqual({ n: 0 })
    }
    // What is not the case's own stays.
    expect(db.prepare('SELECT name FROM tags').all()).toEqual([{ name: 'review' }])
    expect(db.prepare('SELECT name FROM analysis_groups').all()).toEqual([{ name: 'FAM' }])
  })

  it('migration v44 removes the dependent rows earlier overwrites left behind', () => {
    db.pragma('foreign_keys = OFF')
    db.exec(`
      INSERT INTO cases (name, file_path, file_size, created_at) VALUES ('kept', '/k.json', 1, 1);
      INSERT INTO case_comments (case_id, category, content, created_at)
        VALUES (1, 'general', 'kept', 1), (999, 'general', 'orphan', 1);
      INSERT INTO tags (name, color, created_at) VALUES ('review', '#fff', 1);
      INSERT INTO variant_tags (case_id, variant_id, tag_id, created_at) VALUES (999, 888, 1, 1);
      INSERT INTO case_cohort_links (case_id, cohort_id) VALUES (999, 1);
      PRAGMA user_version = 43;
    `)
    expect(db.pragma('foreign_key_check')).not.toEqual([])

    runMigrations(db)

    expect(db.pragma('foreign_key_check')).toEqual([])
    expect(db.prepare('SELECT content FROM case_comments').all()).toEqual([{ content: 'kept' }])
    expect(db.prepare('SELECT name FROM tags').all()).toEqual([{ name: 'review' }])
  })
})
