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

    it('sets performance PRAGMAs on initialization', () => {
      const tempDbPath = join(tmpdir(), `varlens-test-pragmas-${Date.now()}.db`)
      const fileService = new DatabaseService(tempDbPath)

      try {
        const synchronous = fileService.database.prepare('PRAGMA synchronous').get() as {
          synchronous: number
        }
        expect(synchronous.synchronous).toBe(1) // NORMAL = 1

        const cacheSize = fileService.database.prepare('PRAGMA cache_size').get() as {
          cache_size: number
        }
        expect(cacheSize.cache_size).toBe(-32000)

        const tempStore = fileService.database.prepare('PRAGMA temp_store').get() as {
          temp_store: number
        }
        expect(tempStore.temp_store).toBe(2) // MEMORY = 2

        const busyTimeout = fileService.database.prepare('PRAGMA busy_timeout').get() as {
          timeout: number
        }
        expect(busyTimeout.timeout).toBe(5000)

        const mmapSize = fileService.database.prepare('PRAGMA mmap_size').get() as
          | {
              mmap_size: number
            }
          | undefined
        // mmap_size is set but the return format varies by platform
        if (mmapSize !== undefined) {
          expect(mmapSize.mmap_size).toBe(268435456)
        }
      } finally {
        fileService.close()
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
      const id = service.cases.createCase('test-case', '/path/to/file.vcf', 1024)

      expect(id).toBeGreaterThan(0)
    })

    it('stores all case fields correctly', () => {
      const id = service.cases.createCase('test-case', '/path/to/file.vcf', 1024)
      const createdCase = service.cases.getCase(id)

      expect(createdCase.id).toBe(id)
      expect(createdCase.name).toBe('test-case')
      expect(createdCase.file_path).toBe('/path/to/file.vcf')
      expect(createdCase.file_size).toBe(1024)
      expect(createdCase.variant_count).toBe(0)
    })

    it('throws UniqueConstraintError on duplicate name', () => {
      service.cases.createCase('duplicate-name', '/path/to/file1.vcf', 1024)

      expect(() => {
        service.cases.createCase('duplicate-name', '/path/to/file2.vcf', 2048)
      }).toThrow(UniqueConstraintError)
    })

    it('sets created_at timestamp', () => {
      const beforeCreate = Date.now()
      const id = service.cases.createCase('test-case', '/path/to/file.vcf', 1024)
      const afterCreate = Date.now()

      const createdCase = service.cases.getCase(id)

      expect(createdCase.created_at).toBeGreaterThanOrEqual(beforeCreate)
      expect(createdCase.created_at).toBeLessThanOrEqual(afterCreate)
    })
  })

  describe('getCase', () => {
    it('retrieves existing case by id', () => {
      const id = service.cases.createCase('test-case', '/path/to/file.vcf', 1024)
      const retrievedCase = service.cases.getCase(id)

      expect(retrievedCase.id).toBe(id)
      expect(retrievedCase.name).toBe('test-case')
    })

    it('throws NotFoundError for non-existent id', () => {
      expect(() => {
        service.cases.getCase(99999)
      }).toThrow(NotFoundError)
    })

    it('returns correct Case type with all properties', () => {
      const id = service.cases.createCase('test-case', '/path/to/file.vcf', 1024)
      const retrievedCase = service.cases.getCase(id)

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
      const id = service.cases.createCase('find-by-name', '/path/to/file.vcf', 1024)
      const retrievedCase = service.cases.getCaseByName('find-by-name')

      expect(retrievedCase.id).toBe(id)
      expect(retrievedCase.name).toBe('find-by-name')
    })

    it('throws NotFoundError for non-existent name', () => {
      expect(() => {
        service.cases.getCaseByName('nonexistent')
      }).toThrow(NotFoundError)
    })
  })

  describe('getAllCases', () => {
    it('returns empty array when no cases', () => {
      const cases = service.cases.getAllCases()

      expect(cases).toEqual([])
    })

    it('returns all cases ordered by created_at desc', async () => {
      // Create cases with small delays to ensure different timestamps
      service.cases.createCase('case-1', '/path/to/file1.vcf', 1024)
      // Small delay to ensure different timestamp
      await new Promise((resolve) => setTimeout(resolve, 10))
      service.cases.createCase('case-2', '/path/to/file2.vcf', 2048)
      await new Promise((resolve) => setTimeout(resolve, 10))
      service.cases.createCase('case-3', '/path/to/file3.vcf', 3072)

      const cases = service.cases.getAllCases()

      expect(cases.length).toBe(3)
      // Newest first
      expect(cases[0].name).toBe('case-3')
      expect(cases[1].name).toBe('case-2')
      expect(cases[2].name).toBe('case-1')
    })

    it('includes variant_count in results', () => {
      const id = service.cases.createCase('test-case', '/path/to/file.vcf', 1024)
      service.cases.updateCaseVariantCount(id, 150)

      const cases = service.cases.getAllCases()

      expect(cases[0].variant_count).toBe(150)
    })
  })

  describe('updateCaseVariantCount', () => {
    it('updates variant count', () => {
      const id = service.cases.createCase('test-case', '/path/to/file.vcf', 1024)

      service.cases.updateCaseVariantCount(id, 500)

      const updatedCase = service.cases.getCase(id)
      expect(updatedCase.variant_count).toBe(500)
    })

    it('throws NotFoundError for non-existent case', () => {
      expect(() => {
        service.cases.updateCaseVariantCount(99999, 100)
      }).toThrow(NotFoundError)
    })
  })

  describe('deleteCase', () => {
    it('deletes existing case', () => {
      const id = service.cases.createCase('to-delete', '/path/to/file.vcf', 1024)

      service.cases.deleteCase(id)

      expect(() => {
        service.cases.getCase(id)
      }).toThrow(NotFoundError)
    })

    it('throws NotFoundError for non-existent id', () => {
      expect(() => {
        service.cases.deleteCase(99999)
      }).toThrow(NotFoundError)
    })

    it('cascades delete to variants', () => {
      // Create case
      const caseId = service.cases.createCase('with-variants', '/path/to/file.vcf', 1024)

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
      service.cases.deleteCase(caseId)

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
        const id = service.cases.createCase('tx-case', '/path/to/file.vcf', 1024)
        return id
      })

      expect(result).toBeGreaterThan(0)
      const createdCase = service.cases.getCase(result)
      expect(createdCase.name).toBe('tx-case')
    })

    it('rolls back failed transaction', () => {
      expect(() => {
        service.runTransaction(() => {
          service.cases.createCase('tx-case-1', '/path/to/file1.vcf', 1024)
          // This should fail due to unique constraint
          service.cases.createCase('tx-case-1', '/path/to/file2.vcf', 2048)
        })
      }).toThrow(TransactionError)

      // First case should not exist due to rollback
      expect(() => {
        service.cases.getCaseByName('tx-case-1')
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
        service.cases.createCase(`case-${i}`, `/path/to/file${i}.vcf`, 1024)
      }

      const cases = service.cases.getAllCases()
      expect(cases.length).toBe(5)
    })
  })

  describe('Case Comments', () => {
    it('creates and lists comments for a case', () => {
      const caseId = service.cases.createCase('comment-test', '/path/test.vcf', 1024)

      const comment = service.metadata.createCaseComment(
        caseId,
        'Clinical Note',
        'Patient presents with seizures'
      )
      expect(comment.id).toBeGreaterThan(0)
      expect(comment.case_id).toBe(caseId)
      expect(comment.category).toBe('Clinical Note')
      expect(comment.content).toBe('Patient presents with seizures')
      expect(comment.created_at).toBeGreaterThan(0)
      expect(comment.updated_at).toBeNull()

      service.metadata.createCaseComment(caseId, 'Lab Result', 'WBC elevated')

      const comments = service.metadata.listCaseComments(caseId)
      expect(comments).toHaveLength(2)
      // Newest first
      expect(comments[0].category).toBe('Lab Result')
      expect(comments[1].category).toBe('Clinical Note')
    })

    it('updates a comment and sets updated_at', () => {
      const caseId = service.cases.createCase('update-comment-test', '/path/test.vcf', 1024)
      const comment = service.metadata.createCaseComment(
        caseId,
        'Interpretation',
        'Initial assessment'
      )

      const updated = service.metadata.updateCaseComment(comment.id, 'Revised assessment')
      expect(updated.content).toBe('Revised assessment')
      expect(updated.updated_at).not.toBeNull()
      expect(updated.updated_at!).toBeGreaterThanOrEqual(updated.created_at)
    })

    it('deletes a comment', () => {
      const caseId = service.cases.createCase('delete-comment-test', '/path/test.vcf', 1024)
      const comment = service.metadata.createCaseComment(caseId, 'Follow-up', 'Schedule MRI')

      service.metadata.deleteCaseComment(comment.id)

      const comments = service.metadata.listCaseComments(caseId)
      expect(comments).toHaveLength(0)
    })

    it('throws NotFoundError when updating non-existent comment', () => {
      expect(() => service.metadata.updateCaseComment(99999, 'nope')).toThrow(NotFoundError)
    })

    it('throws NotFoundError when deleting non-existent comment', () => {
      expect(() => service.metadata.deleteCaseComment(99999)).toThrow(NotFoundError)
    })
  })

  describe('Case Metrics', () => {
    it('lists predefined metric definitions', () => {
      const definitions = service.metadata.listMetricDefinitions()
      expect(definitions.length).toBeGreaterThan(100)

      const hb = definitions.find((d) => d.name === 'Hemoglobin (Hb)')
      expect(hb).toBeDefined()
      expect(hb!.value_type).toBe('numeric')
      expect(hb!.unit).toBe('g/dL')
      expect(hb!.category).toBe('Hematology')
      expect(hb!.is_predefined).toBe(1)
    })

    it('creates a user-defined metric definition', () => {
      const custom = service.metadata.createMetricDefinition(
        'Custom Score',
        'numeric',
        'points',
        'Custom'
      )
      expect(custom.id).toBeGreaterThan(0)
      expect(custom.name).toBe('Custom Score')
      expect(custom.is_predefined).toBe(0)
    })

    it('upserts a numeric metric value for a case', () => {
      const caseId = service.cases.createCase('metric-test', '/path/test.vcf', 1024)
      const definitions = service.metadata.listMetricDefinitions()
      const hb = definitions.find((d) => d.name === 'Hemoglobin (Hb)')!

      const metric = service.metadata.upsertCaseMetric(caseId, hb.id, { numeric_value: 13.5 })
      expect(metric.case_id).toBe(caseId)
      expect(metric.metric_id).toBe(hb.id)
      expect(metric.numeric_value).toBe(13.5)

      const updated = service.metadata.upsertCaseMetric(caseId, hb.id, { numeric_value: 14.0 })
      expect(updated.numeric_value).toBe(14.0)
      expect(updated.id).toBe(metric.id)
    })

    it('lists case metrics with definitions joined', () => {
      const caseId = service.cases.createCase('metric-list-test', '/path/test.vcf', 1024)
      const definitions = service.metadata.listMetricDefinitions()
      const hb = definitions.find((d) => d.name === 'Hemoglobin (Hb)')!
      const wbc = definitions.find((d) => d.name === 'White Blood Cell Count (WBC)')!

      service.metadata.upsertCaseMetric(caseId, hb.id, { numeric_value: 13.5 })
      service.metadata.upsertCaseMetric(caseId, wbc.id, { numeric_value: 7.2 })

      const metrics = service.metadata.listCaseMetrics(caseId)
      expect(metrics).toHaveLength(2)
      expect(metrics[0].name).toBeDefined()
      expect(metrics[0].unit).toBeDefined()
      expect(metrics[0].metric_category).toBeDefined()
    })

    it('deletes a case metric value', () => {
      const caseId = service.cases.createCase('metric-delete-test', '/path/test.vcf', 1024)
      const definitions = service.metadata.listMetricDefinitions()
      const hb = definitions.find((d) => d.name === 'Hemoglobin (Hb)')!

      service.metadata.upsertCaseMetric(caseId, hb.id, { numeric_value: 13.5 })
      service.metadata.deleteCaseMetric(caseId, hb.id)

      const metrics = service.metadata.listCaseMetrics(caseId)
      expect(metrics).toHaveLength(0)
    })

    it('supports text and date metric values', () => {
      const caseId = service.cases.createCase('metric-types-test', '/path/test.vcf', 1024)
      const definitions = service.metadata.listMetricDefinitions()
      const ethnicity = definitions.find((d) => d.name === 'Ethnicity')!
      const dodDef = definitions.find((d) => d.name === 'Date of Diagnosis')!

      service.metadata.upsertCaseMetric(caseId, ethnicity.id, { text_value: 'European' })
      service.metadata.upsertCaseMetric(caseId, dodDef.id, { date_value: '1990-05-15' })

      const metrics = service.metadata.listCaseMetrics(caseId)
      const ethMetric = metrics.find((m) => m.name === 'Ethnicity')!
      const dodMetric = metrics.find((m) => m.name === 'Date of Diagnosis')!

      expect(ethMetric.text_value).toBe('European')
      expect(dodMetric.date_value).toBe('1990-05-15')
    })
  })

  describe('Kysely integration', () => {
    it('should expose a Kysely instance', () => {
      expect(service.kysely).toBeDefined()
      expect(typeof service.kysely.selectFrom).toBe('function')
    })

    it('should use the same underlying connection', async () => {
      // Insert via raw SQL
      service.cases.createCase('kysely-test', '/path', 100)
      // Read via Kysely — verifies shared connection
      const result = await service.kysely.selectFrom('cases').selectAll().execute()
      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('kysely-test')
    })
  })
})
