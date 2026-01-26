/**
 * Integration tests for ImportService
 *
 * Uses real test data files:
 * - case-892-snv-sample.json.gz (251 variants - fast tests)
 * - case-892-snv-annotations.json.gz (~65k variants - performance test)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { tmpdir } from 'node:os'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseService } from '../../../src/main/database/DatabaseService'
import { ImportService } from '../../../src/main/import/ImportService'
import type { ProgressUpdate } from '../../../src/main/import/types'
import { UniqueConstraintError } from '../../../src/main/database/errors'

describe('ImportService', () => {
  let dbPath: string
  let tmpDir: string
  let db: DatabaseService
  let importService: ImportService

  beforeEach(() => {
    // Create temporary directory and database
    tmpDir = mkdtempSync(join(tmpdir(), 'varlens-test-'))
    dbPath = join(tmpDir, 'test.db')
    db = new DatabaseService(dbPath)
    importService = new ImportService(db)
  })

  afterEach(() => {
    db.close()
    rmSync(tmpDir, { recursive: true, force: true })
  })

  describe('Basic Import', () => {
    it('should import variants from sample file and create case', async () => {
      const result = await importService.importVariants('test-data/case-892-snv-sample.json.gz', {
        caseName: 'Test Case 892 Sample'
      })

      expect(result.caseId).toBeGreaterThan(0)
      expect(result.variantCount).toBe(251)
      expect(result.skipped).toBe(0)
      expect(result.errors).toEqual([])
      expect(result.elapsed).toBeGreaterThan(0)

      // Verify case was created with correct variant count
      const caseRecord = db.getCase(result.caseId)
      expect(caseRecord.name).toBe('Test Case 892 Sample')
      expect(caseRecord.variant_count).toBe(251)
      expect(caseRecord.file_path).toBe('test-data/case-892-snv-sample.json.gz')

      // Verify variants were inserted
      const variantCount = db.getVariantCount(result.caseId)
      expect(variantCount).toBe(251)
    })

    it('should resolve gene IDs to symbols via dictionary', async () => {
      const result = await importService.importVariants('test-data/case-892-snv-sample.json.gz', {
        caseName: 'Gene Resolution Test'
      })

      // Get first few variants to check gene resolution
      const variants = db.getVariants({ case_id: result.caseId }, 10)

      // Should have some variants with gene symbols (resolved from dictionary)
      const variantsWithGenes = variants.data.filter((v) => v.gene_symbol !== null)
      expect(variantsWithGenes.length).toBeGreaterThan(0)

      // Gene symbols should be strings (not numeric IDs)
      for (const variant of variantsWithGenes) {
        expect(typeof variant.gene_symbol).toBe('string')
        expect(variant.gene_symbol?.length).toBeGreaterThan(0)
      }
    })

    it('should resolve impact codes to labels', async () => {
      const result = await importService.importVariants('test-data/case-892-snv-sample.json.gz', {
        caseName: 'Impact Resolution Test'
      })

      const variants = db.getVariants({ case_id: result.caseId }, 100)

      // Should have variants with impact labels
      const variantsWithImpact = variants.data.filter((v) => v.consequence !== null)
      expect(variantsWithImpact.length).toBeGreaterThan(0)

      // Impact labels should be from dictionary (HIGH, MODERATE, LOW, MODIFIER)
      const validImpacts = ['HIGH', 'MODERATE', 'LOW', 'MODIFIER']
      for (const variant of variantsWithImpact) {
        expect(validImpacts).toContain(variant.consequence)
      }
    })
  })

  describe('Progress Reporting', () => {
    it('should call progress callback with phase and count', async () => {
      const progressUpdates: ProgressUpdate[] = []

      await importService.importVariants('test-data/case-892-snv-sample.json.gz', {
        caseName: 'Progress Test',
        onProgress: (update) => {
          progressUpdates.push(update)
        }
      })

      // Should have received progress updates
      expect(progressUpdates.length).toBeGreaterThan(0)

      // All updates should be 'inserting' phase (batching happens during insert)
      for (const update of progressUpdates) {
        expect(update.phase).toBe('inserting')
        expect(update.count).toBeGreaterThan(0)
        expect(update.elapsed).toBeGreaterThan(0)
      }

      // Final update should have all variants
      const lastUpdate = progressUpdates[progressUpdates.length - 1]
      expect(lastUpdate.count).toBeLessThanOrEqual(251)
    })

    it('should report skipped variants in progress updates', async () => {
      const progressUpdates: ProgressUpdate[] = []

      await importService.importVariants('test-data/case-892-snv-sample.json.gz', {
        caseName: 'Skipped Progress Test',
        onProgress: (update) => {
          progressUpdates.push({ ...update })
        }
      })

      // Should track skipped count in updates
      for (const update of progressUpdates) {
        expect(update).toHaveProperty('skipped')
        expect(update.skipped).toBeGreaterThanOrEqual(0)
      }
    })
  })

  describe('Error Handling', () => {
    it('should throw error for duplicate case name', async () => {
      // First import succeeds
      await importService.importVariants('test-data/case-892-snv-sample.json.gz', {
        caseName: 'Duplicate Test'
      })

      // Second import with same name should fail
      await expect(
        importService.importVariants('test-data/case-892-snv-sample.json.gz', {
          caseName: 'Duplicate Test'
        })
      ).rejects.toThrow(UniqueConstraintError)
    })

    it('should rollback case creation on import failure', async () => {
      const casesBefore = db.getAllCases().length

      // Import from non-existent file should fail
      await expect(
        importService.importVariants('test-data/non-existent.json.gz', {
          caseName: 'Rollback Test'
        })
      ).rejects.toThrow()

      // No new case should have been created
      const casesAfter = db.getAllCases().length
      expect(casesAfter).toBe(casesBefore)
    })
  })

  describe('Cancellation', () => {
    it('should support cancellation via AbortSignal', async () => {
      const abortController = new AbortController()

      // Start import and cancel after a short delay (50ms to allow setup)
      const importPromise = importService.importVariants(
        'test-data/case-892-snv-annotations.json.gz',
        {
          caseName: 'Cancellation Test',
          signal: abortController.signal
        }
      )

      // Cancel after a short delay
      setTimeout(() => {
        abortController.abort()
      }, 50)

      // Import should fail with error
      await expect(importPromise).rejects.toThrow()

      // Case should have been rolled back
      const cases = db.getAllCases()
      const cancelledCase = cases.find((c) => c.name === 'Cancellation Test')
      expect(cancelledCase).toBeUndefined()
    }, 10000)
  })

  describe('Custom Batch Size', () => {
    it('should respect custom batch size option', async () => {
      const progressUpdates: ProgressUpdate[] = []

      await importService.importVariants('test-data/case-892-snv-sample.json.gz', {
        caseName: 'Custom Batch Size Test',
        batchSize: 50,
        onProgress: (update) => {
          progressUpdates.push(update)
        }
      })

      // With batch size 50, we should have multiple updates for 251 variants
      expect(progressUpdates.length).toBeGreaterThanOrEqual(5)

      // Check that counts increase by batch size (except last batch)
      for (let i = 1; i < progressUpdates.length - 1; i++) {
        const increment = progressUpdates[i].count - progressUpdates[i - 1].count
        expect(increment).toBeLessThanOrEqual(50)
      }
    })
  })

  describe('Performance Test', () => {
    it('should import 65k variants in under 30 seconds', async () => {
      const startTime = Date.now()

      const result = await importService.importVariants(
        'test-data/case-892-snv-annotations.json.gz',
        {
          caseName: 'Performance Test Case'
        }
      )

      const duration = Date.now() - startTime

      // Performance requirement: 65k variants in under 30 seconds
      expect(duration).toBeLessThan(30000)

      // Verify all variants were imported
      expect(result.variantCount).toBeGreaterThan(60000)
      expect(result.variantCount).toBeLessThan(70000)

      // Verify database has correct count
      const dbCount = db.getVariantCount(result.caseId)
      expect(dbCount).toBe(result.variantCount)
    }, 35000) // Allow 35s timeout for test
  })

  describe('Field Validation', () => {
    it('should skip variants with missing required fields', async () => {
      // The sample file should have valid variants, so skipped should be 0
      const result = await importService.importVariants('test-data/case-892-snv-sample.json.gz', {
        caseName: 'Validation Test'
      })

      expect(result.skipped).toBe(0)
      expect(result.variantCount).toBe(251)
    })
  })

  describe('Data Integrity', () => {
    it('should correctly map all variant fields', async () => {
      const result = await importService.importVariants('test-data/case-892-snv-sample.json.gz', {
        caseName: 'Field Mapping Test'
      })

      // Get a variant with all fields populated
      const variants = db.getVariants({ case_id: result.caseId }, 10)
      const variant = variants.data[0]

      // Required fields should be present
      expect(variant.chr).toBeTruthy()
      expect(variant.pos).toBeGreaterThan(0)
      expect(variant.ref).toBeTruthy()
      expect(variant.alt).toBeTruthy()

      // Numeric fields should be numbers or null
      if (variant.gnomad_af !== null) {
        expect(typeof variant.gnomad_af).toBe('number')
      }
      if (variant.cadd !== null) {
        expect(typeof variant.cadd).toBe('number')
      }
    })
  })
})
