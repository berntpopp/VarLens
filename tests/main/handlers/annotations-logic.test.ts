/**
 * Annotations logic unit tests
 *
 * Tests the extracted annotations-logic module directly with a real in-memory SQLite backend.
 * Focuses on upsert behavior, audit trail creation, and batch operations.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { DatabaseService } from '../../../src/main/database/DatabaseService'
import * as annotationsLogic from '../../../src/main/ipc/handlers/annotations-logic'

describe('annotations-logic', () => {
  let db: DatabaseService
  let getDb: () => DatabaseService
  let caseId: number
  let variantId: number

  const insertCase = (name: string): number => {
    const result = db.database
      .prepare(
        'INSERT INTO cases (name, file_path, file_size, variant_count, created_at) VALUES (?, ?, ?, ?, ?)'
      )
      .run(name, `/test/path/${name}.json`, 1000, 0, Date.now())
    return result.lastInsertRowid as number
  }

  const insertVariant = (
    cId: number,
    chr: string,
    pos: number,
    ref: string,
    alt: string
  ): number => {
    const result = db.database
      .prepare(
        'INSERT INTO variants (case_id, chr, pos, ref, alt, gt_num) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(cId, chr, pos, ref, alt, '0/1')
    return result.lastInsertRowid as number
  }

  beforeEach(() => {
    db = new DatabaseService(':memory:')
    getDb = () => db
    caseId = insertCase('Test Case')
    variantId = insertVariant(caseId, '1', 12345, 'A', 'G')
  })

  afterEach(() => {
    db.close()
  })

  const coords: annotationsLogic.GlobalVariantCoords = {
    chr: '1',
    pos: 12345,
    ref: 'A',
    alt: 'G',
    genome_build: 'GRCh38'
  }

  describe('getGlobalAnnotation', () => {
    it('returns null when no annotation exists (no pool)', async () => {
      const result = await annotationsLogic.getGlobalAnnotation(coords, getDb)
      expect(result).toBeNull()
    })
  })

  describe('getAnnotationsForVariant', () => {
    it('returns null global and perCase when none exist (no pool)', async () => {
      const result = (await annotationsLogic.getAnnotationsForVariant(caseId, coords, getDb)) as {
        global: unknown
        perCase: unknown
      }

      expect(result.global).toBeNull()
      expect(result.perCase).toBeNull()
    })

    it('returns both global and per-case annotations', async () => {
      db.annotations.upsertGlobalAnnotation('1', 12345, 'A', 'G', 'GRCh38', {
        global_comment: 'Global note'
      })
      db.annotations.upsertPerCaseAnnotation(caseId, variantId, { per_case_comment: 'Case note' })

      const result = (await annotationsLogic.getAnnotationsForVariant(caseId, coords, getDb)) as {
        global: { global_comment: string }
        perCase: { per_case_comment: string }
      }

      expect(result.global.global_comment).toBe('Global note')
      expect(result.perCase.per_case_comment).toBe('Case note')
    })
  })

  describe('batchGetAnnotations', () => {
    it('returns empty object for empty keys (no pool)', async () => {
      const result = await annotationsLogic.batchGetAnnotations(caseId, [], getDb)
      expect(result).toEqual({})
    })

    it('returns annotations keyed by chr:pos:ref:alt', async () => {
      db.annotations.upsertGlobalAnnotation('1', 12345, 'A', 'G', 'GRCh38', { starred: 1 })

      const result = (await annotationsLogic.batchGetAnnotations(
        caseId,
        [{ chr: '1', pos: 12345, ref: 'A', alt: 'G' }],
        getDb
      )) as Record<string, { global: { starred: number } | null; perCase: unknown }>

      expect(result['1:12345:A:G']).toBeDefined()
      expect(result['1:12345:A:G'].global).not.toBeNull()
      expect(result['1:12345:A:G'].global!.starred).toBe(1)
    })
  })
})
