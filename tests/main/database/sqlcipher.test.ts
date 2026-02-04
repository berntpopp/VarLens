/**
 * SQLCipher Encryption Tests
 *
 * Comprehensive tests validating that better-sqlite3-multiple-ciphers encryption
 * works correctly end-to-end with DatabaseService.
 *
 * Tests cover:
 * - Encrypted database creation and reopening with correct key
 * - Wrong key rejection
 * - Unencrypted database regression guard
 * - FTS5 functionality on encrypted databases
 * - FTS5 persistence after reopen
 * - Low-level library verification
 */

import { describe, it, expect, afterEach } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { unlinkSync, existsSync } from 'fs'
import Database from 'better-sqlite3-multiple-ciphers'
import { DatabaseService } from '../../../src/main/database'

describe('SQLCipher Encryption', () => {
  // Track temp files for cleanup
  const tempFiles: string[] = []

  function tempDbPath(): string {
    const p = join(
      tmpdir(),
      `varlens-sqlcipher-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
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

  describe('Encrypted database lifecycle', () => {
    it('creates encrypted database and reopens with correct key', () => {
      const dbPath = tempDbPath()
      const encryptionKey = 'test-password-123'

      // Create encrypted database and insert data
      let service = new DatabaseService(dbPath, encryptionKey)
      const caseId = service.createCase('encrypted-case', '/path/to/file.vcf', 1024)

      // Insert a test variant
      service.insertVariantsBatch(caseId, [
        {
          chr: '1',
          pos: 10000,
          ref: 'A',
          alt: 'G',
          gene_symbol: 'TEST1',
          consequence: 'missense_variant',
          gnomad_af: 0.01,
          cadd: 15.0,
          clinvar: null,
          gt_num: '0/1',
          func: 'missense_variant',
          qual: 100,
          hpo_sim_score: null,
          transcript: 'NM_001.1',
          cdna: 'c.100A>G',
          aa_change: 'p.Lys33Arg',
          moi: null
        }
      ])

      service.close()

      // Reopen with the same key and verify data is accessible
      service = new DatabaseService(dbPath, encryptionKey)

      const cases = service.getAllCases()
      expect(cases).toHaveLength(1)
      expect(cases[0].name).toBe('encrypted-case')

      const variantCount = service.getVariantCount(caseId)
      expect(variantCount).toBe(1)

      service.close()
    })

    it('throws error when opening encrypted database with wrong key', () => {
      const dbPath = tempDbPath()
      const correctKey = 'correct-key'
      const wrongKey = 'wrong-key'

      // Create encrypted database
      let service = new DatabaseService(dbPath, correctKey)
      service.createCase('test-case', '/path/to/file.vcf', 1024)
      service.close()

      // Attempt to open with wrong key should fail during schema initialization
      expect(() => {
        service = new DatabaseService(dbPath, wrongKey)
      }).toThrow()
    })

    it('works with unencrypted database when no key provided (regression guard)', () => {
      // This test ensures existing behavior is preserved
      const service = new DatabaseService(':memory:')

      service.createCase('unencrypted-case', '/path/to/file.vcf', 512)
      const cases = service.getAllCases()

      expect(cases).toHaveLength(1)
      expect(cases[0].name).toBe('unencrypted-case')

      service.close()
    })
  })

  describe('FTS5 on encrypted databases', () => {
    it('FTS5 search works on encrypted database after PRAGMA key', () => {
      const dbPath = tempDbPath()
      const encryptionKey = 'fts5-test-key'

      const service = new DatabaseService(dbPath, encryptionKey)
      const caseId = service.createCase('fts5-case', '/path/to/file.vcf', 1024)

      // Insert a variant with searchable gene_symbol
      service.database
        .prepare(
          `INSERT INTO variants (case_id, chr, pos, ref, alt, gene_symbol, consequence, gnomad_af, cadd, clinvar, gt_num, func, qual, hpo_sim_score, transcript, cdna, aa_change, moi)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          caseId,
          '17',
          43044295,
          'G',
          'A',
          'BRCA1',
          'missense_variant',
          0.001,
          25.3,
          'pathogenic',
          '0/1',
          'missense_variant',
          200,
          null,
          'NM_007294.3',
          'c.5266G>A',
          'p.Gly1756Ser',
          null
        )

      // Search using FTS5
      const results = service.searchVariants(caseId, 'BRCA1', 10)

      expect(results).toHaveLength(1)
      expect(results[0].gene_symbol).toBe('BRCA1')
      expect(results[0].consequence).toBe('missense_variant')

      service.close()
    })

    it('FTS5 persists after reopening encrypted database with correct key', () => {
      const dbPath = tempDbPath()
      const encryptionKey = 'fts5-persist-key'

      // Create encrypted database and insert variant
      let service = new DatabaseService(dbPath, encryptionKey)
      const caseId = service.createCase('fts5-persist-case', '/path/to/file.vcf', 1024)

      service.database
        .prepare(
          `INSERT INTO variants (case_id, chr, pos, ref, alt, gene_symbol, consequence, gnomad_af, cadd, clinvar, gt_num, func, qual, hpo_sim_score, transcript, cdna, aa_change, moi)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          caseId,
          '13',
          32315474,
          'G',
          'T',
          'BRCA2',
          'frameshift_variant',
          0.0001,
          30.0,
          'likely_pathogenic',
          '1/1',
          'frameshift_variant',
          250,
          null,
          'NM_000059.3',
          'c.9097del',
          'p.Thr3033fs',
          null
        )

      service.close()

      // Reopen with same key and verify FTS5 works
      service = new DatabaseService(dbPath, encryptionKey)

      const results = service.searchVariants(caseId, 'BRCA2', 10)

      expect(results).toHaveLength(1)
      expect(results[0].gene_symbol).toBe('BRCA2')
      expect(results[0].consequence).toBe('frameshift_variant')

      service.close()
    })
  })

  describe('Low-level library verification', () => {
    it('verifies raw Database library encryption without DatabaseService', () => {
      const dbPath = tempDbPath()
      const correctKey = 'library-test-key'
      const wrongKey = 'wrong-library-key'

      // Create encrypted database at library level
      let db = new Database(dbPath)
      db.pragma(`key='${correctKey}'`)
      db.exec('CREATE TABLE test_data (id INTEGER PRIMARY KEY, value TEXT)')
      db.prepare('INSERT INTO test_data (value) VALUES (?)').run('encrypted-data')
      db.close()

      // Reopen with correct key and verify data
      db = new Database(dbPath)
      db.pragma(`key='${correctKey}'`)
      const result = db.prepare('SELECT value FROM test_data WHERE id = 1').get() as {
        value: string
      }
      expect(result.value).toBe('encrypted-data')
      db.close()

      // Reopen with wrong key and verify query fails
      db = new Database(dbPath)
      db.pragma(`key='${wrongKey}'`)

      expect(() => {
        db.prepare('SELECT value FROM test_data WHERE id = 1').get()
      }).toThrow()

      db.close()
    })

    it('verifies encrypted database file cannot be opened without key', () => {
      const dbPath = tempDbPath()
      const encryptionKey = 'no-key-test'

      // Create encrypted database
      let db = new Database(dbPath)
      db.pragma(`key='${encryptionKey}'`)
      db.exec('CREATE TABLE test_data (id INTEGER PRIMARY KEY, value TEXT)')
      db.prepare('INSERT INTO test_data (value) VALUES (?)').run('secret-data')
      db.close()

      // Attempt to open without key should fail on first query
      db = new Database(dbPath)
      // No PRAGMA key issued

      expect(() => {
        db.prepare('SELECT value FROM test_data').get()
      }).toThrow()

      db.close()
    })
  })

  describe('PRAGMA key ordering', () => {
    it('verifies PRAGMA key is issued before WAL mode and foreign keys', () => {
      const dbPath = tempDbPath()
      const encryptionKey = 'ordering-test-key'

      // This test succeeds if DatabaseService constructor doesn't throw
      // The internal ordering (key → WAL → foreign_keys → schema) must be correct
      const service = new DatabaseService(dbPath, encryptionKey)

      // Verify WAL mode was set after PRAGMA key
      const walMode = service.database.prepare('PRAGMA journal_mode').get() as {
        journal_mode: string
      }
      expect(walMode.journal_mode).toBe('wal')

      // Verify foreign keys were enabled after PRAGMA key
      const fkEnabled = service.database.prepare('PRAGMA foreign_keys').get() as {
        foreign_keys: number
      }
      expect(fkEnabled.foreign_keys).toBe(1)

      // Verify schema was initialized successfully (tables exist)
      const tables = service.database
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        .all() as Array<{ name: string }>

      const tableNames = tables.map((t) => t.name)
      expect(tableNames).toContain('cases')
      expect(tableNames).toContain('variants')
      expect(tableNames).toContain('variants_fts')

      service.close()
    })
  })
})
