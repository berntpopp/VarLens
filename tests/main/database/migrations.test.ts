/**
 * Schema Migration Tests
 *
 * Comprehensive tests validating that schema migrations work correctly on
 * SQLCipher-encrypted databases. Tests foreign key cascade deletes, migration
 * idempotency, and PRAGMA user_version persistence.
 *
 * Tests cover:
 * - Annotation tables creation on encrypted databases
 * - PRAGMA user_version persistence across reopens
 * - Foreign key cascade deletes (7 scenarios)
 * - Migration idempotency (safe to run twice)
 * - Plaintext database regression guard
 * - Foreign keys pragma verification
 */

import { describe, it, expect, afterEach } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { unlinkSync, existsSync } from 'fs'
import { DatabaseService } from '../../../src/main/database'

describe('Schema Migrations', () => {
  // Track temp files for cleanup
  const tempFiles: string[] = []

  function tempDbPath(): string {
    const p = join(
      tmpdir(),
      `varlens-migrations-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
    )
    tempFiles.push(p)
    return p
  }

  function cleanupTempFile(dbPath: string): void {
    for (const suffix of ['', '-wal', '-shm']) {
      const filePath = `${dbPath}${suffix}`
      if (existsSync(filePath)) {
        try {
          unlinkSync(filePath)
        } catch {
          /* ignore cleanup errors */
        }
      }
    }
  }

  afterEach(() => {
    for (const f of tempFiles) {
      cleanupTempFile(f)
    }
    tempFiles.length = 0
  })

  /**
   * Helper function to insert a test variant
   *
   * @param service - DatabaseService instance
   * @param caseId - Case ID to associate variant with
   * @returns ID of inserted variant
   */
  function insertTestVariant(service: DatabaseService, caseId: number): number {
    const result = service.database
      .prepare(
        `INSERT INTO variants (case_id, chr, pos, ref, alt, gene_symbol, consequence, gnomad_af, cadd, clinvar, gt_num, func, qual, hpo_sim_score, transcript, cdna, aa_change, moi)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        caseId,
        '1',
        100,
        'A',
        'G',
        'TEST',
        'missense_variant',
        0.01,
        15.0,
        null,
        '0/1',
        'missense_variant',
        100,
        null,
        'NM_001.1',
        'c.100A>G',
        'p.Lys33Arg',
        null
      )
    return Number(result.lastInsertRowid)
  }

  describe('Migration on encrypted databases', () => {
    it('creates annotation tables on encrypted database', () => {
      const dbPath = tempDbPath()
      const encryptionKey = 'migration-test-key'

      const service = new DatabaseService(dbPath, encryptionKey)

      // Query sqlite_master for new tables
      const tables = service.database
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        .all() as Array<{ name: string }>

      const tableNames = tables.map((t) => t.name)

      // Verify all 9 v0.4.0 annotation tables exist
      expect(tableNames).toContain('variant_annotations')
      expect(tableNames).toContain('case_variant_annotations')
      expect(tableNames).toContain('case_metadata')
      expect(tableNames).toContain('cohort_groups')
      expect(tableNames).toContain('case_cohort_links')
      expect(tableNames).toContain('api_cache')
      expect(tableNames).toContain('tags')
      expect(tableNames).toContain('variant_tags')
      expect(tableNames).toContain('case_hpo_terms')

      service.close()
    })

    it('sets PRAGMA user_version to 4 after migration', () => {
      const dbPath = tempDbPath()
      const encryptionKey = 'version-test-key'

      let service = new DatabaseService(dbPath, encryptionKey)

      // Check user_version after migration
      const versionResult = service.database.prepare('PRAGMA user_version').get() as {
        user_version: number
      }
      expect(versionResult.user_version).toBe(25)

      service.close()

      // Reopen with same key and verify version persists
      service = new DatabaseService(dbPath, encryptionKey)

      const versionAfterReopen = service.database.prepare('PRAGMA user_version').get() as {
        user_version: number
      }
      expect(versionAfterReopen.user_version).toBe(25)

      service.close()
    })
  })

  describe('Foreign key cascades', () => {
    it('cascades delete to case_variant_annotations when case deleted', () => {
      const dbPath = tempDbPath()
      const encryptionKey = 'cascade-test-key-1'

      const service = new DatabaseService(dbPath, encryptionKey)

      // Create case and variant
      const caseId = service.cases.createCase('test-case', '/path/to/file.vcf', 1024)
      const variantId = insertTestVariant(service, caseId)

      // Insert case_variant_annotation
      service.database
        .prepare(
          `INSERT INTO case_variant_annotations (case_id, variant_id, per_case_comment, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run(caseId, variantId, 'Test comment', Date.now(), Date.now())

      // Verify annotation exists
      let count = service.database
        .prepare('SELECT COUNT(*) as count FROM case_variant_annotations')
        .get() as { count: number }
      expect(count.count).toBe(1)

      // Delete case
      service.database.prepare('DELETE FROM cases WHERE id = ?').run(caseId)

      // Verify annotation was cascaded
      count = service.database
        .prepare('SELECT COUNT(*) as count FROM case_variant_annotations')
        .get() as { count: number }
      expect(count.count).toBe(0)

      service.close()
    })

    it('cascades delete to case_metadata when case deleted', () => {
      const dbPath = tempDbPath()
      const encryptionKey = 'cascade-test-key-2'

      const service = new DatabaseService(dbPath, encryptionKey)

      // Create case
      const caseId = service.cases.createCase('test-case', '/path/to/file.vcf', 1024)

      // Insert case_metadata
      service.database
        .prepare(
          `INSERT INTO case_metadata (case_id, affected_status, notes, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run(caseId, 'affected', 'Test notes', Date.now(), Date.now())

      // Verify metadata exists
      let count = service.database.prepare('SELECT COUNT(*) as count FROM case_metadata').get() as {
        count: number
      }
      expect(count.count).toBe(1)

      // Delete case
      service.database.prepare('DELETE FROM cases WHERE id = ?').run(caseId)

      // Verify metadata was cascaded
      count = service.database.prepare('SELECT COUNT(*) as count FROM case_metadata').get() as {
        count: number
      }
      expect(count.count).toBe(0)

      service.close()
    })

    it('cascades delete to case_cohort_links when case deleted', () => {
      const dbPath = tempDbPath()
      const encryptionKey = 'cascade-test-key-3'

      const service = new DatabaseService(dbPath, encryptionKey)

      // Create case
      const caseId = service.cases.createCase('test-case', '/path/to/file.vcf', 1024)

      // Create cohort_group
      const cohortResult = service.database
        .prepare(
          `INSERT INTO cohort_groups (name, description, created_at)
           VALUES (?, ?, ?)`
        )
        .run('Test Cohort', 'Test description', Date.now())
      const cohortId = Number(cohortResult.lastInsertRowid)

      // Link case to cohort
      service.database
        .prepare(
          `INSERT INTO case_cohort_links (case_id, cohort_id)
           VALUES (?, ?)`
        )
        .run(caseId, cohortId)

      // Verify link exists
      let linkCount = service.database
        .prepare('SELECT COUNT(*) as count FROM case_cohort_links')
        .get() as { count: number }
      expect(linkCount.count).toBe(1)

      // Delete case
      service.database.prepare('DELETE FROM cases WHERE id = ?').run(caseId)

      // Verify link was cascaded
      linkCount = service.database
        .prepare('SELECT COUNT(*) as count FROM case_cohort_links')
        .get() as { count: number }
      expect(linkCount.count).toBe(0)

      // Verify cohort_group still exists (not cascaded)
      const cohortCount = service.database
        .prepare('SELECT COUNT(*) as count FROM cohort_groups')
        .get() as { count: number }
      expect(cohortCount.count).toBe(1)

      service.close()
    })

    it('cascades delete to variant_tags when case deleted', () => {
      const dbPath = tempDbPath()
      const encryptionKey = 'cascade-test-key-4'

      const service = new DatabaseService(dbPath, encryptionKey)

      // Create case and variant
      const caseId = service.cases.createCase('test-case', '/path/to/file.vcf', 1024)
      const variantId = insertTestVariant(service, caseId)

      // Create tag
      const tagResult = service.database
        .prepare(
          `INSERT INTO tags (name, color, created_at)
           VALUES (?, ?, ?)`
        )
        .run('candidate', '#FF5733', Date.now())
      const tagId = Number(tagResult.lastInsertRowid)

      // Link variant to tag
      service.database
        .prepare(
          `INSERT INTO variant_tags (case_id, variant_id, tag_id, created_at)
           VALUES (?, ?, ?, ?)`
        )
        .run(caseId, variantId, tagId, Date.now())

      // Verify tag link exists
      let tagLinkCount = service.database
        .prepare('SELECT COUNT(*) as count FROM variant_tags')
        .get() as { count: number }
      expect(tagLinkCount.count).toBe(1)

      // Delete case
      service.database.prepare('DELETE FROM cases WHERE id = ?').run(caseId)

      // Verify tag link was cascaded
      tagLinkCount = service.database
        .prepare('SELECT COUNT(*) as count FROM variant_tags')
        .get() as {
        count: number
      }
      expect(tagLinkCount.count).toBe(0)

      // Verify tag still exists (not cascaded)
      const tagCount = service.database.prepare('SELECT COUNT(*) as count FROM tags').get() as {
        count: number
      }
      expect(tagCount.count).toBe(1)

      service.close()
    })

    it('cascades delete to case_hpo_terms when case deleted', () => {
      const dbPath = tempDbPath()
      const encryptionKey = 'cascade-test-key-5'

      const service = new DatabaseService(dbPath, encryptionKey)

      // Create case
      const caseId = service.cases.createCase('test-case', '/path/to/file.vcf', 1024)

      // Insert HPO term
      service.database
        .prepare(
          `INSERT INTO case_hpo_terms (case_id, hpo_id, hpo_label, created_at)
           VALUES (?, ?, ?, ?)`
        )
        .run(caseId, 'HP:0000001', 'Test phenotype', Date.now())

      // Verify HPO term exists
      let count = service.database
        .prepare('SELECT COUNT(*) as count FROM case_hpo_terms')
        .get() as { count: number }
      expect(count.count).toBe(1)

      // Delete case
      service.database.prepare('DELETE FROM cases WHERE id = ?').run(caseId)

      // Verify HPO term was cascaded
      count = service.database.prepare('SELECT COUNT(*) as count FROM case_hpo_terms').get() as {
        count: number
      }
      expect(count.count).toBe(0)

      service.close()
    })

    it('cascades delete to variant_tags when tag deleted', () => {
      const dbPath = tempDbPath()
      const encryptionKey = 'cascade-test-key-6'

      const service = new DatabaseService(dbPath, encryptionKey)

      // Create case and variant
      const caseId = service.cases.createCase('test-case', '/path/to/file.vcf', 1024)
      const variantId = insertTestVariant(service, caseId)

      // Create tag
      const tagResult = service.database
        .prepare(
          `INSERT INTO tags (name, color, created_at)
           VALUES (?, ?, ?)`
        )
        .run('pathogenic', '#FF0000', Date.now())
      const tagId = Number(tagResult.lastInsertRowid)

      // Link variant to tag
      service.database
        .prepare(
          `INSERT INTO variant_tags (case_id, variant_id, tag_id, created_at)
           VALUES (?, ?, ?, ?)`
        )
        .run(caseId, variantId, tagId, Date.now())

      // Verify tag link exists
      let count = service.database.prepare('SELECT COUNT(*) as count FROM variant_tags').get() as {
        count: number
      }
      expect(count.count).toBe(1)

      // Delete tag
      service.database.prepare('DELETE FROM tags WHERE id = ?').run(tagId)

      // Verify tag link was cascaded
      count = service.database.prepare('SELECT COUNT(*) as count FROM variant_tags').get() as {
        count: number
      }
      expect(count.count).toBe(0)

      service.close()
    })

    it('cascades delete to case_cohort_links when cohort deleted', () => {
      const dbPath = tempDbPath()
      const encryptionKey = 'cascade-test-key-7'

      const service = new DatabaseService(dbPath, encryptionKey)

      // Create case
      const caseId = service.cases.createCase('test-case', '/path/to/file.vcf', 1024)

      // Create cohort_group
      const cohortResult = service.database
        .prepare(
          `INSERT INTO cohort_groups (name, description, created_at)
           VALUES (?, ?, ?)`
        )
        .run('Cohort to Delete', 'Will be deleted', Date.now())
      const cohortId = Number(cohortResult.lastInsertRowid)

      // Link case to cohort
      service.database
        .prepare(
          `INSERT INTO case_cohort_links (case_id, cohort_id)
           VALUES (?, ?)`
        )
        .run(caseId, cohortId)

      // Verify link exists
      let count = service.database
        .prepare('SELECT COUNT(*) as count FROM case_cohort_links')
        .get() as { count: number }
      expect(count.count).toBe(1)

      // Delete cohort
      service.database.prepare('DELETE FROM cohort_groups WHERE id = ?').run(cohortId)

      // Verify link was cascaded
      count = service.database.prepare('SELECT COUNT(*) as count FROM case_cohort_links').get() as {
        count: number
      }
      expect(count.count).toBe(0)

      service.close()
    })
  })

  describe('Migration idempotency', () => {
    it('migration is idempotent - can run twice safely', () => {
      const dbPath = tempDbPath()
      const encryptionKey = 'idempotent-test-key'

      // First open - migrations run in constructor
      let service = new DatabaseService(dbPath, encryptionKey)

      // Verify tables exist
      let tables = service.database
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        .all() as Array<{ name: string }>

      const tableNames = tables.map((t) => t.name)
      expect(tableNames).toContain('variant_annotations')
      expect(tableNames).toContain('case_variant_annotations')

      // Check user_version
      let versionResult = service.database.prepare('PRAGMA user_version').get() as {
        user_version: number
      }
      expect(versionResult.user_version).toBe(25)

      service.close()

      // Reopen - migrations run again (idempotency test)
      service = new DatabaseService(dbPath, encryptionKey)

      // Verify tables still exist
      tables = service.database
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        .all() as Array<{ name: string }>

      const tableNamesAfterReopen = tables.map((t) => t.name)
      expect(tableNamesAfterReopen).toContain('variant_annotations')
      expect(tableNamesAfterReopen).toContain('case_variant_annotations')

      // Verify user_version is 18 (v15 creates filter_presets, v16 reseeds, v17 adds perf indexes, v18 adds covering index)
      versionResult = service.database.prepare('PRAGMA user_version').get() as {
        user_version: number
      }
      expect(versionResult.user_version).toBe(25)

      service.close()
    })
  })

  describe('Plaintext database regression', () => {
    it('migration on plaintext database works identically', () => {
      const dbPath = tempDbPath()

      // Create plaintext DB (no encryption key)
      const service = new DatabaseService(dbPath)

      // Verify all 9 tables exist
      const tables = service.database
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        .all() as Array<{ name: string }>

      const tableNames = tables.map((t) => t.name)

      expect(tableNames).toContain('variant_annotations')
      expect(tableNames).toContain('case_variant_annotations')
      expect(tableNames).toContain('case_metadata')
      expect(tableNames).toContain('cohort_groups')
      expect(tableNames).toContain('case_cohort_links')
      expect(tableNames).toContain('api_cache')
      expect(tableNames).toContain('tags')
      expect(tableNames).toContain('variant_tags')
      expect(tableNames).toContain('case_hpo_terms')

      // Verify user_version is 18
      const versionResult = service.database.prepare('PRAGMA user_version').get() as {
        user_version: number
      }
      expect(versionResult.user_version).toBe(25)

      service.close()
    })
  })

  describe('Schema: variant_transcripts table', () => {
    it('should create variant_transcripts table', () => {
      const db = new DatabaseService(':memory:')
      const tables = db.database
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='variant_transcripts'")
        .all()
      expect(tables).toHaveLength(1)
      db.close()
    })

    it('should create indexes on variant_transcripts', () => {
      const db = new DatabaseService(':memory:')
      const indexes = db.database
        .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_vt_%'")
        .all() as { name: string }[]
      const indexNames = indexes.map((i) => i.name)
      expect(indexNames).toContain('idx_vt_variant_id')
      expect(indexNames).toContain('idx_vt_selected')
      expect(indexNames).toContain('idx_vt_transcript')
      db.close()
    })
  })

  describe('v5 migration - performance indexes', () => {
    it('creates covering index for filter options', () => {
      const service = new DatabaseService(':memory:')
      const indexes = service.database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='index' AND name = 'idx_variants_filter_covering'"
        )
        .all()
      expect(indexes).toHaveLength(1)
      service.close()
    })

    it('creates composite index for variant lookup with case_id', () => {
      const service = new DatabaseService(':memory:')
      const indexes = service.database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='index' AND name = 'idx_variants_case_coords'"
        )
        .all()
      expect(indexes).toHaveLength(1)
      service.close()
    })

    it('creates partial index on gene_symbol for gene burden', () => {
      const service = new DatabaseService(':memory:')
      const indexes = service.database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='index' AND name = 'idx_variants_gene_notnull'"
        )
        .all()
      expect(indexes).toHaveLength(1)
      service.close()
    })

    it('creates index on variant_annotations acmg_classification', () => {
      const service = new DatabaseService(':memory:')
      const indexes = service.database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='index' AND name = 'idx_variant_annotations_acmg'"
        )
        .all()
      expect(indexes).toHaveLength(1)
      service.close()
    })
  })

  describe('Migration v6 - Comments and Metrics', () => {
    it('creates case_comments, metric_definitions, and case_metrics tables', () => {
      const dbPath = tempDbPath()
      const service = new DatabaseService(dbPath)

      const tables = service.database
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        .all() as Array<{ name: string }>
      const tableNames = tables.map((t) => t.name)

      expect(tableNames).toContain('case_comments')
      expect(tableNames).toContain('metric_definitions')
      expect(tableNames).toContain('case_metrics')

      service.close()
    })

    it('seeds predefined metric definitions', () => {
      const dbPath = tempDbPath()
      const service = new DatabaseService(dbPath)

      const count = service.database
        .prepare('SELECT COUNT(*) as count FROM metric_definitions WHERE is_predefined = 1')
        .get() as { count: number }

      // Should have ~120 predefined metrics
      expect(count.count).toBeGreaterThan(100)

      service.close()
    })

    it('cascades delete to case_comments when case deleted', () => {
      const dbPath = tempDbPath()
      const service = new DatabaseService(dbPath)

      const caseId = service.cases.createCase('test-case', '/path/to/file.vcf', 1024)

      service.database
        .prepare(
          'INSERT INTO case_comments (case_id, category, content, created_at) VALUES (?, ?, ?, ?)'
        )
        .run(caseId, 'Clinical Note', 'Test comment', Date.now())

      let count = service.database.prepare('SELECT COUNT(*) as count FROM case_comments').get() as {
        count: number
      }
      expect(count.count).toBe(1)

      service.database.prepare('DELETE FROM cases WHERE id = ?').run(caseId)

      count = service.database.prepare('SELECT COUNT(*) as count FROM case_comments').get() as {
        count: number
      }
      expect(count.count).toBe(0)

      service.close()
    })

    it('cascades delete to case_metrics when case deleted', () => {
      const dbPath = tempDbPath()
      const service = new DatabaseService(dbPath)

      const caseId = service.cases.createCase('test-case', '/path/to/file.vcf', 1024)

      const metric = service.database
        .prepare('SELECT id FROM metric_definitions LIMIT 1')
        .get() as { id: number }

      service.database
        .prepare(
          'INSERT INTO case_metrics (case_id, metric_id, numeric_value, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
        )
        .run(caseId, metric.id, 7.5, Date.now(), Date.now())

      let count = service.database.prepare('SELECT COUNT(*) as count FROM case_metrics').get() as {
        count: number
      }
      expect(count.count).toBe(1)

      service.database.prepare('DELETE FROM cases WHERE id = ?').run(caseId)

      count = service.database.prepare('SELECT COUNT(*) as count FROM case_metrics').get() as {
        count: number
      }
      expect(count.count).toBe(0)

      service.close()
    })

    it('enforces unique constraint on case_metrics(case_id, metric_id)', () => {
      const dbPath = tempDbPath()
      const service = new DatabaseService(dbPath)

      const caseId = service.cases.createCase('test-case', '/path/to/file.vcf', 1024)
      const metric = service.database
        .prepare('SELECT id FROM metric_definitions LIMIT 1')
        .get() as { id: number }
      const now = Date.now()

      service.database
        .prepare(
          'INSERT INTO case_metrics (case_id, metric_id, numeric_value, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
        )
        .run(caseId, metric.id, 7.5, now, now)

      expect(() => {
        service.database
          .prepare(
            'INSERT INTO case_metrics (case_id, metric_id, numeric_value, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
          )
          .run(caseId, metric.id, 8.0, now, now)
      }).toThrow()

      service.close()
    })
  })

  describe('Migration v7 - Audit Log', () => {
    it('creates audit_log table with correct columns', () => {
      const service = new DatabaseService(':memory:')

      const columns = service.database.prepare("PRAGMA table_info('audit_log')").all() as Array<{
        name: string
        type: string
        notnull: number
      }>
      const colNames = columns.map((c) => c.name)

      expect(colNames).toContain('id')
      expect(colNames).toContain('timestamp')
      expect(colNames).toContain('action_type')
      expect(colNames).toContain('entity_type')
      expect(colNames).toContain('entity_key')
      expect(colNames).toContain('old_value')
      expect(colNames).toContain('new_value')
      expect(colNames).toContain('user_name')

      service.close()
    })

    it('creates indexes on audit_log', () => {
      const service = new DatabaseService(':memory:')

      const indexes = service.database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_audit_log_%'"
        )
        .all() as Array<{ name: string }>
      const indexNames = indexes.map((i) => i.name)

      expect(indexNames).toContain('idx_audit_log_entity_key')
      expect(indexNames).toContain('idx_audit_log_timestamp')
      expect(indexNames).toContain('idx_audit_log_action_type')

      service.close()
    })

    it('sets user_version to 7', () => {
      const service = new DatabaseService(':memory:')

      const version = service.database.prepare('PRAGMA user_version').get() as {
        user_version: number
      }
      expect(version.user_version).toBe(25)

      service.close()
    })
  })

  describe('Migration v14 - Annotation flags and cohort_frequency', () => {
    it('should add annotation columns and frequency to cohort_variant_summary in v14', () => {
      const dbPath = tempDbPath()
      const service = new DatabaseService(dbPath)

      const db = service.database

      // Verify new columns exist
      const columns = db.prepare("PRAGMA table_info('cohort_variant_summary')").all() as {
        name: string
        type: string
        notnull: number
      }[]
      const columnNames = columns.map((c) => c.name)

      expect(columnNames).toContain('has_star')
      expect(columnNames).toContain('has_comment')
      expect(columnNames).toContain('acmg_best')
      expect(columnNames).toContain('cohort_frequency')

      // Verify has_star has NOT NULL constraint
      const hasStar = columns.find((c) => c.name === 'has_star')!
      expect(hasStar.notnull).toBe(1)

      // Verify cohort_frequency index exists
      const indexes = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='cohort_variant_summary'"
        )
        .all() as { name: string }[]
      const indexNames = indexes.map((i) => i.name)
      expect(indexNames).toContain('idx_cvs_cohort_freq')

      // Verify user_version = 18 (v15 + v16 + v17 + v18 all run)
      const version = db.pragma('user_version', { simple: true }) as number
      expect(version).toBe(25)

      service.close()
    })
  })

  describe('Foreign keys pragma verification', () => {
    it('verifies foreign_keys pragma is ON', () => {
      const dbPath = tempDbPath()
      const encryptionKey = 'fk-pragma-test-key'

      const service = new DatabaseService(dbPath, encryptionKey)

      // Query PRAGMA foreign_keys
      const fkResult = service.database.prepare('PRAGMA foreign_keys').get() as {
        foreign_keys: number
      }

      // Must be 1 (ON) for cascade deletes to work
      expect(fkResult.foreign_keys).toBe(1)

      service.close()
    })
  })
})
