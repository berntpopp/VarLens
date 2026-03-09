/**
 * Annotations IPC handler integration tests
 *
 * Tests annotation repository methods with real SQLite backend.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { DatabaseService } from '../../../src/main/database/DatabaseService'

describe('annotation IPC handlers', () => {
  let db: DatabaseService
  let caseId: number
  let variantId: number

  // Helper to insert a case
  const insertCase = (name: string): number => {
    const result = db.database
      .prepare(
        'INSERT INTO cases (name, file_path, file_size, variant_count, created_at) VALUES (?, ?, ?, ?, ?)'
      )
      .run(name, `/test/path/${name}.json`, 1000, 0, Date.now())
    return result.lastInsertRowid as number
  }

  // Helper to insert a variant and return its id
  const insertVariant = (
    caseId: number,
    chr: string,
    pos: number,
    ref: string,
    alt: string
  ): number => {
    const result = db.database
      .prepare(
        `INSERT INTO variants (case_id, chr, pos, ref, alt, gt_num) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(caseId, chr, pos, ref, alt, '0/1')
    return result.lastInsertRowid as number
  }

  beforeEach(() => {
    db = new DatabaseService(':memory:')
    caseId = insertCase('Test Case')
    variantId = insertVariant(caseId, '1', 12345, 'A', 'G')
  })

  afterEach(() => {
    db.close()
  })

  describe('getAnnotationsForVariant (annotations:getForVariant)', () => {
    it('returns null annotations when none exist', () => {
      const result = db.annotations.getAnnotationsForVariant(caseId, '1', 12345, 'A', 'G')

      expect(result).toHaveProperty('global')
      expect(result).toHaveProperty('perCase')
      expect(result.global).toBeNull()
      expect(result.perCase).toBeNull()
    })

    it('returns global and per-case annotations for a variant', () => {
      // Create global annotation
      db.annotations.upsertGlobalAnnotation('1', 12345, 'A', 'G', {
        global_comment: 'Global note',
        starred: 1,
        acmg_classification: 'Pathogenic'
      })

      // Create per-case annotation
      db.annotations.upsertPerCaseAnnotation(caseId, variantId, {
        per_case_comment: 'Per-case note',
        starred: 0,
        acmg_classification: 'Likely Pathogenic'
      })

      const result = db.annotations.getAnnotationsForVariant(caseId, '1', 12345, 'A', 'G')

      expect(result.global).not.toBeNull()
      expect(result.global!.global_comment).toBe('Global note')
      expect(result.global!.starred).toBe(1)
      expect(result.global!.acmg_classification).toBe('Pathogenic')

      expect(result.perCase).not.toBeNull()
      expect(result.perCase!.per_case_comment).toBe('Per-case note')
      expect(result.perCase!.starred).toBe(0)
      expect(result.perCase!.acmg_classification).toBe('Likely Pathogenic')
    })
  })

  describe('upsertGlobalAnnotation (annotations:upsertGlobal)', () => {
    it('creates a new global annotation', () => {
      const result = db.annotations.upsertGlobalAnnotation('1', 12345, 'A', 'G', {
        global_comment: 'Test comment',
        acmg_classification: 'Pathogenic'
      })

      expect(result).toHaveProperty('id')
      expect(result.chr).toBe('1')
      expect(result.pos).toBe(12345)
      expect(result.ref).toBe('A')
      expect(result.alt).toBe('G')
      expect(result.global_comment).toBe('Test comment')
      expect(result.acmg_classification).toBe('Pathogenic')
      expect(result.starred).toBe(0) // default
    })

    it('updates an existing global annotation', () => {
      // Create initial
      db.annotations.upsertGlobalAnnotation('1', 12345, 'A', 'G', {
        global_comment: 'Initial comment'
      })

      // Update
      const result = db.annotations.upsertGlobalAnnotation('1', 12345, 'A', 'G', {
        global_comment: 'Updated comment',
        starred: 1
      })

      expect(result.global_comment).toBe('Updated comment')
      expect(result.starred).toBe(1)
    })

    it('handles updating annotation for nonexistent variant coordinates gracefully', () => {
      // Upserting for coordinates that have no variant row should still work
      // because global annotations are keyed by chr/pos/ref/alt, not variant id
      const result = db.annotations.upsertGlobalAnnotation('99', 99999, 'C', 'T', {
        global_comment: 'Annotation for unknown variant'
      })

      expect(result.chr).toBe('99')
      expect(result.pos).toBe(99999)
      expect(result.global_comment).toBe('Annotation for unknown variant')
    })
  })

  describe('upsertPerCaseAnnotation (annotations:upsertPerCase)', () => {
    it('creates a new per-case annotation', () => {
      const result = db.annotations.upsertPerCaseAnnotation(caseId, variantId, {
        per_case_comment: 'Case-specific note',
        acmg_classification: 'VUS'
      })

      expect(result).toHaveProperty('id')
      expect(result.case_id).toBe(caseId)
      expect(result.variant_id).toBe(variantId)
      expect(result.per_case_comment).toBe('Case-specific note')
      expect(result.acmg_classification).toBe('VUS')
      expect(result.starred).toBe(0)
    })

    it('updates existing per-case annotation', () => {
      db.annotations.upsertPerCaseAnnotation(caseId, variantId, {
        per_case_comment: 'First note'
      })

      const result = db.annotations.upsertPerCaseAnnotation(caseId, variantId, {
        per_case_comment: 'Updated note',
        starred: 1
      })

      expect(result.per_case_comment).toBe('Updated note')
      expect(result.starred).toBe(1)
    })
  })

  describe('deleteGlobalAnnotation (annotations:deleteGlobal)', () => {
    it('deletes an existing global annotation', () => {
      db.annotations.upsertGlobalAnnotation('1', 12345, 'A', 'G', {
        global_comment: 'To be deleted'
      })

      db.annotations.deleteGlobalAnnotation('1', 12345, 'A', 'G')

      const result = db.annotations.getGlobalAnnotation('1', 12345, 'A', 'G')
      expect(result).toBeNull()
    })
  })

  describe('deletePerCaseAnnotation (annotations:deletePerCase)', () => {
    it('deletes an existing per-case annotation', () => {
      db.annotations.upsertPerCaseAnnotation(caseId, variantId, {
        per_case_comment: 'To be deleted'
      })

      db.annotations.deletePerCaseAnnotation(caseId, variantId)

      const result = db.annotations.getPerCaseAnnotation(caseId, variantId)
      expect(result).toBeNull()
    })
  })
})
