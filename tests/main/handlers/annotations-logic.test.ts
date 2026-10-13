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

  describe('upsertGlobalAnnotation', () => {
    it('creates a new global annotation', () => {
      const result = annotationsLogic.upsertGlobalAnnotation(
        coords,
        { global_comment: 'Test comment', acmg_classification: 'Pathogenic' },
        getDb
      ) as { global_comment: string; acmg_classification: string; starred: number }

      expect(result.global_comment).toBe('Test comment')
      expect(result.acmg_classification).toBe('Pathogenic')
      expect(result.starred).toBe(0)
    })

    it('updates an existing global annotation', () => {
      annotationsLogic.upsertGlobalAnnotation(coords, { global_comment: 'Initial' }, getDb)

      const result = annotationsLogic.upsertGlobalAnnotation(
        coords,
        { global_comment: 'Updated', starred: true },
        getDb
      ) as { global_comment: string; starred: number }

      expect(result.global_comment).toBe('Updated')
      expect(result.starred).toBe(1)
    })

    it('creates audit trail for ACMG classification change', () => {
      annotationsLogic.upsertGlobalAnnotation(
        coords,
        { acmg_classification: 'VUS', user_name: 'testuser' },
        getDb
      )

      // Verify audit log entry was created
      const entries = db.database
        .prepare("SELECT * FROM audit_log WHERE action_type = 'acmg_classify'")
        .all() as Array<{
        action_type: string
        entity_type: string
        user_name: string
        new_value: string
      }>

      expect(entries.length).toBe(1)
      expect(entries[0].entity_type).toBe('variant_annotation')
      expect(entries[0].user_name).toBe('testuser')
      expect(JSON.parse(entries[0].new_value)).toEqual({ acmg_classification: 'VUS' })
    })

    it('creates audit trail for star/unstar', () => {
      annotationsLogic.upsertGlobalAnnotation(coords, { starred: true }, getDb)

      const entries = db.database
        .prepare("SELECT * FROM audit_log WHERE action_type = 'star'")
        .all()
      expect(entries.length).toBe(1)
    })

    it('creates audit trail for ACMG evidence update', () => {
      annotationsLogic.upsertGlobalAnnotation(coords, { acmg_evidence: 'PS1,PM2' }, getDb)

      const entries = db.database
        .prepare("SELECT * FROM audit_log WHERE action_type = 'acmg_evidence_update'")
        .all()
      expect(entries.length).toBe(1)
    })
  })

  describe('deleteGlobalAnnotation', () => {
    it('deletes an existing global annotation', async () => {
      annotationsLogic.upsertGlobalAnnotation(coords, { global_comment: 'To delete' }, getDb)

      annotationsLogic.deleteGlobalAnnotation(coords, getDb)

      const result = await annotationsLogic.getGlobalAnnotation(coords, getDb)
      expect(result).toBeNull()
    })
  })

  describe('upsertPerCaseAnnotation', () => {
    it('creates a new per-case annotation', () => {
      const result = annotationsLogic.upsertPerCaseAnnotation(
        caseId,
        variantId,
        { per_case_comment: 'Case note', acmg_classification: 'Likely Pathogenic' },
        getDb
      ) as { per_case_comment: string; acmg_classification: string }

      expect(result.per_case_comment).toBe('Case note')
      expect(result.acmg_classification).toBe('Likely Pathogenic')
    })

    it('creates audit trail for per-case ACMG classification', () => {
      annotationsLogic.upsertPerCaseAnnotation(
        caseId,
        variantId,
        { acmg_classification: 'Benign', user_name: 'analyst' },
        getDb
      )

      const entries = db.database
        .prepare(
          "SELECT * FROM audit_log WHERE action_type = 'acmg_classify' AND entity_type = 'case_variant_annotation'"
        )
        .all() as Array<{ entity_key: string; user_name: string }>

      expect(entries.length).toBe(1)
      expect(entries[0].entity_key).toBe(`case:${caseId}:variant:${variantId}`)
      expect(entries[0].user_name).toBe('analyst')
    })
  })

  describe('deletePerCaseAnnotation', () => {
    it('deletes an existing per-case annotation', async () => {
      annotationsLogic.upsertPerCaseAnnotation(
        caseId,
        variantId,
        { per_case_comment: 'To delete' },
        getDb
      )

      annotationsLogic.deletePerCaseAnnotation(caseId, variantId, getDb)

      const result = await annotationsLogic.getPerCaseAnnotation(caseId, variantId, getDb)
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
      annotationsLogic.upsertGlobalAnnotation(coords, { global_comment: 'Global note' }, getDb)
      annotationsLogic.upsertPerCaseAnnotation(
        caseId,
        variantId,
        { per_case_comment: 'Case note' },
        getDb
      )

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
      annotationsLogic.upsertGlobalAnnotation(coords, { starred: true }, getDb)

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
