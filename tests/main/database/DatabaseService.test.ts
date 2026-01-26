import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { unlinkSync, existsSync } from 'fs'
import {
  DatabaseService,
  NotFoundError,
  UniqueConstraintError,
  TransactionError
} from '../../../src/main/database'

describe('DatabaseService', () => {
  let service: DatabaseService

  beforeEach(() => {
    // Create fresh in-memory database for each test
    service = new DatabaseService(':memory:')
  })

  afterEach(() => {
    service.close()
  })

  describe('Initialization', () => {
    it('initializes database with WAL mode', () => {
      // Use a temp file to properly test WAL mode
      // (in-memory databases always use 'memory' mode)
      const tempDbPath = join(tmpdir(), `varlens-test-wal-${Date.now()}.db`)
      const fileService = new DatabaseService(tempDbPath)

      try {
        const result = fileService.database.prepare('PRAGMA journal_mode').get() as {
          journal_mode: string
        }

        expect(result.journal_mode).toBe('wal')
      } finally {
        fileService.close()
        // Clean up temp files
        if (existsSync(tempDbPath)) unlinkSync(tempDbPath)
        if (existsSync(`${tempDbPath}-wal`)) unlinkSync(`${tempDbPath}-wal`)
        if (existsSync(`${tempDbPath}-shm`)) unlinkSync(`${tempDbPath}-shm`)
      }
    })

    it('initializes database with foreign keys enabled', () => {
      const result = service.database.prepare('PRAGMA foreign_keys').get() as {
        foreign_keys: number
      }

      expect(result.foreign_keys).toBe(1)
    })

    it('creates all tables on initialization', () => {
      const tables = service.database
        .prepare(
          `
          SELECT name FROM sqlite_master
          WHERE type='table' AND name NOT LIKE 'sqlite_%'
          ORDER BY name
        `
        )
        .all() as Array<{ name: string }>

      const tableNames = tables.map((t) => t.name)
      expect(tableNames).toContain('cases')
      expect(tableNames).toContain('variants')
      expect(tableNames).toContain('variants_fts')
    })
  })

  describe('createCase', () => {
    it('creates case and returns id', () => {
      const id = service.createCase('test-case', '/path/to/file.vcf', 1024)

      expect(id).toBeGreaterThan(0)
    })

    it('stores all case fields correctly', () => {
      const id = service.createCase('test-case', '/path/to/file.vcf', 1024)
      const createdCase = service.getCase(id)

      expect(createdCase.id).toBe(id)
      expect(createdCase.name).toBe('test-case')
      expect(createdCase.file_path).toBe('/path/to/file.vcf')
      expect(createdCase.file_size).toBe(1024)
      expect(createdCase.variant_count).toBe(0)
    })

    it('throws UniqueConstraintError on duplicate name', () => {
      service.createCase('duplicate-name', '/path/to/file1.vcf', 1024)

      expect(() => {
        service.createCase('duplicate-name', '/path/to/file2.vcf', 2048)
      }).toThrow(UniqueConstraintError)
    })

    it('sets created_at timestamp', () => {
      const beforeCreate = Date.now()
      const id = service.createCase('test-case', '/path/to/file.vcf', 1024)
      const afterCreate = Date.now()

      const createdCase = service.getCase(id)

      expect(createdCase.created_at).toBeGreaterThanOrEqual(beforeCreate)
      expect(createdCase.created_at).toBeLessThanOrEqual(afterCreate)
    })
  })

  describe('getCase', () => {
    it('retrieves existing case by id', () => {
      const id = service.createCase('test-case', '/path/to/file.vcf', 1024)
      const retrievedCase = service.getCase(id)

      expect(retrievedCase.id).toBe(id)
      expect(retrievedCase.name).toBe('test-case')
    })

    it('throws NotFoundError for non-existent id', () => {
      expect(() => {
        service.getCase(99999)
      }).toThrow(NotFoundError)
    })

    it('returns correct Case type with all properties', () => {
      const id = service.createCase('test-case', '/path/to/file.vcf', 1024)
      const retrievedCase = service.getCase(id)

      expect(retrievedCase).toHaveProperty('id')
      expect(retrievedCase).toHaveProperty('name')
      expect(retrievedCase).toHaveProperty('file_path')
      expect(retrievedCase).toHaveProperty('file_size')
      expect(retrievedCase).toHaveProperty('variant_count')
      expect(retrievedCase).toHaveProperty('created_at')
    })
  })

  describe('getCaseByName', () => {
    it('retrieves existing case by name', () => {
      const id = service.createCase('find-by-name', '/path/to/file.vcf', 1024)
      const retrievedCase = service.getCaseByName('find-by-name')

      expect(retrievedCase.id).toBe(id)
      expect(retrievedCase.name).toBe('find-by-name')
    })

    it('throws NotFoundError for non-existent name', () => {
      expect(() => {
        service.getCaseByName('nonexistent')
      }).toThrow(NotFoundError)
    })
  })

  describe('getAllCases', () => {
    it('returns empty array when no cases', () => {
      const cases = service.getAllCases()

      expect(cases).toEqual([])
    })

    it('returns all cases ordered by created_at desc', async () => {
      // Create cases with small delays to ensure different timestamps
      service.createCase('case-1', '/path/to/file1.vcf', 1024)
      // Small delay to ensure different timestamp
      await new Promise((resolve) => setTimeout(resolve, 10))
      service.createCase('case-2', '/path/to/file2.vcf', 2048)
      await new Promise((resolve) => setTimeout(resolve, 10))
      service.createCase('case-3', '/path/to/file3.vcf', 3072)

      const cases = service.getAllCases()

      expect(cases.length).toBe(3)
      // Newest first
      expect(cases[0].name).toBe('case-3')
      expect(cases[1].name).toBe('case-2')
      expect(cases[2].name).toBe('case-1')
    })

    it('includes variant_count in results', () => {
      const id = service.createCase('test-case', '/path/to/file.vcf', 1024)
      service.updateCaseVariantCount(id, 150)

      const cases = service.getAllCases()

      expect(cases[0].variant_count).toBe(150)
    })
  })

  describe('updateCaseVariantCount', () => {
    it('updates variant count', () => {
      const id = service.createCase('test-case', '/path/to/file.vcf', 1024)

      service.updateCaseVariantCount(id, 500)

      const updatedCase = service.getCase(id)
      expect(updatedCase.variant_count).toBe(500)
    })

    it('throws NotFoundError for non-existent case', () => {
      expect(() => {
        service.updateCaseVariantCount(99999, 100)
      }).toThrow(NotFoundError)
    })
  })

  describe('deleteCase', () => {
    it('deletes existing case', () => {
      const id = service.createCase('to-delete', '/path/to/file.vcf', 1024)

      service.deleteCase(id)

      expect(() => {
        service.getCase(id)
      }).toThrow(NotFoundError)
    })

    it('throws NotFoundError for non-existent id', () => {
      expect(() => {
        service.deleteCase(99999)
      }).toThrow(NotFoundError)
    })

    it('cascades delete to variants', () => {
      // Create case
      const caseId = service.createCase('with-variants', '/path/to/file.vcf', 1024)

      // Insert variants directly using the database instance
      service.database
        .prepare(
          'INSERT INTO variants (case_id, chr, pos, ref, alt, gene_symbol, consequence) VALUES (?, ?, ?, ?, ?, ?, ?)'
        )
        .run(caseId, '1', 12345, 'A', 'G', 'BRCA1', 'missense_variant')

      service.database
        .prepare(
          'INSERT INTO variants (case_id, chr, pos, ref, alt, gene_symbol, consequence) VALUES (?, ?, ?, ?, ?, ?, ?)'
        )
        .run(caseId, '2', 67890, 'C', 'T', 'TP53', 'stop_gained')

      // Verify variants exist
      const beforeDelete = service.database
        .prepare('SELECT COUNT(*) as count FROM variants WHERE case_id = ?')
        .get(caseId) as { count: number }
      expect(beforeDelete.count).toBe(2)

      // Delete case
      service.deleteCase(caseId)

      // Verify variants are deleted
      const afterDelete = service.database
        .prepare('SELECT COUNT(*) as count FROM variants WHERE case_id = ?')
        .get(caseId) as { count: number }
      expect(afterDelete.count).toBe(0)
    })
  })

  describe('runTransaction', () => {
    it('commits successful transaction', () => {
      const result = service.runTransaction(() => {
        const id = service.createCase('tx-case', '/path/to/file.vcf', 1024)
        return id
      })

      expect(result).toBeGreaterThan(0)
      const createdCase = service.getCase(result)
      expect(createdCase.name).toBe('tx-case')
    })

    it('rolls back failed transaction', () => {
      expect(() => {
        service.runTransaction(() => {
          service.createCase('tx-case-1', '/path/to/file1.vcf', 1024)
          // This should fail due to unique constraint
          service.createCase('tx-case-1', '/path/to/file2.vcf', 2048)
        })
      }).toThrow(TransactionError)

      // First case should not exist due to rollback
      expect(() => {
        service.getCaseByName('tx-case-1')
      }).toThrow(NotFoundError)
    })

    it('returns value from transaction function', () => {
      const result = service.runTransaction(() => {
        return 'transaction result'
      })

      expect(result).toBe('transaction result')
    })
  })

  describe('Statement caching', () => {
    it('reuses prepared statements for same SQL', () => {
      // This is implicitly tested by ensuring repeated operations work correctly
      for (let i = 0; i < 5; i++) {
        service.createCase(`case-${i}`, `/path/to/file${i}.vcf`, 1024)
      }

      const cases = service.getAllCases()
      expect(cases.length).toBe(5)
    })
  })
})
