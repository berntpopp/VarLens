import { ipcMain } from 'electron'
import { wrapHandler } from '../errorHandler'
import { getDatabaseService } from '../../database'
import type { VariantAnnotation, CaseVariantAnnotation } from '../../database/types'

/**
 * Annotations IPC handlers
 * Channels: annotations:getGlobal, annotations:upsertGlobal, annotations:getPerCase,
 *           annotations:upsertPerCase, annotations:deleteGlobal, annotations:deletePerCase,
 *           annotations:getForVariant
 */

// Type for global annotation updates from renderer
interface GlobalAnnotationUpdates {
  global_comment?: string | null
  starred?: boolean
  acmg_classification?: VariantAnnotation['acmg_classification']
  acmg_evidence?: string | null
  user_name?: string // for audit trail only
}

// Type for per-case annotation updates from renderer
interface PerCaseAnnotationUpdates {
  per_case_comment?: string | null
  starred?: boolean
  acmg_classification?: CaseVariantAnnotation['acmg_classification']
  acmg_evidence?: string | null
  user_name?: string // for audit trail only
}

/**
 * Get global annotation for a variant
 */
ipcMain.handle(
  'annotations:getGlobal',
  async (_event, chr: string, pos: number, ref: string, alt: string) => {
    return wrapHandler(async () => {
      const db = getDatabaseService()
      return db.annotations.getGlobalAnnotation(chr, pos, ref, alt)
    })
  }
)

/**
 * Upsert global annotation for a variant
 */
ipcMain.handle(
  'annotations:upsertGlobal',
  async (
    _event,
    chr: string,
    pos: number,
    ref: string,
    alt: string,
    updates: GlobalAnnotationUpdates
  ) => {
    return wrapHandler(async () => {
      const db = getDatabaseService()

      // Extract user_name before building db updates
      const { user_name, ...annotationUpdates } = updates

      // Read current state before upsert for audit trail
      const oldAnnotation = db.annotations.getGlobalAnnotation(chr, pos, ref, alt)

      // Build dbUpdates only with keys actually provided
      const dbUpdates: Partial<
        Pick<
          VariantAnnotation,
          'global_comment' | 'starred' | 'acmg_classification' | 'acmg_evidence'
        >
      > = {}

      if ('global_comment' in annotationUpdates) {
        dbUpdates.global_comment = annotationUpdates.global_comment
      }
      if ('acmg_classification' in annotationUpdates) {
        dbUpdates.acmg_classification = annotationUpdates.acmg_classification
      }
      if ('acmg_evidence' in annotationUpdates) {
        dbUpdates.acmg_evidence = annotationUpdates.acmg_evidence
      }
      if (annotationUpdates.starred !== undefined) {
        dbUpdates.starred = annotationUpdates.starred ? 1 : 0
      }

      const result = db.annotations.upsertGlobalAnnotation(chr, pos, ref, alt, dbUpdates)

      // Audit logging
      const entityKey = `${chr}:${pos}:${ref}:${alt}`
      if (annotationUpdates.acmg_classification !== undefined) {
        db.auditLog.appendEntry({
          action_type: 'acmg_classify',
          entity_type: 'variant_annotation',
          entity_key: entityKey,
          old_value: oldAnnotation
            ? JSON.stringify({ acmg_classification: oldAnnotation.acmg_classification })
            : null,
          new_value: JSON.stringify({
            acmg_classification: annotationUpdates.acmg_classification
          }),
          user_name: user_name ?? null
        })
      }
      if (annotationUpdates.acmg_evidence !== undefined) {
        db.auditLog.appendEntry({
          action_type: 'acmg_evidence_update',
          entity_type: 'variant_annotation',
          entity_key: entityKey,
          old_value: oldAnnotation
            ? JSON.stringify({ acmg_evidence: oldAnnotation.acmg_evidence })
            : null,
          new_value: JSON.stringify({ acmg_evidence: annotationUpdates.acmg_evidence }),
          user_name: user_name ?? null
        })
      }
      if (annotationUpdates.starred !== undefined) {
        db.auditLog.appendEntry({
          action_type: annotationUpdates.starred ? 'star' : 'unstar',
          entity_type: 'variant_annotation',
          entity_key: entityKey,
          old_value: oldAnnotation ? JSON.stringify({ starred: oldAnnotation.starred }) : null,
          new_value: JSON.stringify({ starred: annotationUpdates.starred ? 1 : 0 }),
          user_name: user_name ?? null
        })
      }

      return result
    })
  }
)

/**
 * Delete global annotation for a variant
 */
ipcMain.handle(
  'annotations:deleteGlobal',
  async (_event, chr: string, pos: number, ref: string, alt: string) => {
    return wrapHandler(async () => {
      const db = getDatabaseService()
      db.annotations.deleteGlobalAnnotation(chr, pos, ref, alt)
      return undefined
    })
  }
)

/**
 * Get per-case annotation for a variant
 */
ipcMain.handle('annotations:getPerCase', async (_event, caseId: number, variantId: number) => {
  return wrapHandler(async () => {
    const db = getDatabaseService()
    return db.annotations.getPerCaseAnnotation(caseId, variantId)
  })
})

/**
 * Upsert per-case annotation for a variant
 * Handles per_case_comment, starred, acmg_classification, acmg_evidence
 */
ipcMain.handle(
  'annotations:upsertPerCase',
  async (_event, caseId: number, variantId: number, updates: PerCaseAnnotationUpdates) => {
    return wrapHandler(async () => {
      const db = getDatabaseService()

      // Extract user_name before building db updates
      const { user_name, ...annotationUpdates } = updates

      // Read current state before upsert for audit trail
      const oldAnnotation = db.annotations.getPerCaseAnnotation(caseId, variantId)

      // Build dbUpdates only with keys actually provided
      const dbUpdates: Partial<
        Pick<
          CaseVariantAnnotation,
          'per_case_comment' | 'starred' | 'acmg_classification' | 'acmg_evidence'
        >
      > = {}

      if ('per_case_comment' in annotationUpdates) {
        dbUpdates.per_case_comment = annotationUpdates.per_case_comment
      }
      if ('acmg_classification' in annotationUpdates) {
        dbUpdates.acmg_classification = annotationUpdates.acmg_classification
      }
      if ('acmg_evidence' in annotationUpdates) {
        dbUpdates.acmg_evidence = annotationUpdates.acmg_evidence
      }
      if (annotationUpdates.starred !== undefined) {
        dbUpdates.starred = annotationUpdates.starred ? 1 : 0
      }

      const result = db.annotations.upsertPerCaseAnnotation(caseId, variantId, dbUpdates)

      // Audit logging
      const entityKey = `case:${caseId}:variant:${variantId}`
      if (annotationUpdates.acmg_classification !== undefined) {
        db.auditLog.appendEntry({
          action_type: 'acmg_classify',
          entity_type: 'case_variant_annotation',
          entity_key: entityKey,
          old_value: oldAnnotation
            ? JSON.stringify({ acmg_classification: oldAnnotation.acmg_classification })
            : null,
          new_value: JSON.stringify({
            acmg_classification: annotationUpdates.acmg_classification
          }),
          user_name: user_name ?? null
        })
      }
      if (annotationUpdates.acmg_evidence !== undefined) {
        db.auditLog.appendEntry({
          action_type: 'acmg_evidence_update',
          entity_type: 'case_variant_annotation',
          entity_key: entityKey,
          old_value: oldAnnotation
            ? JSON.stringify({ acmg_evidence: oldAnnotation.acmg_evidence })
            : null,
          new_value: JSON.stringify({ acmg_evidence: annotationUpdates.acmg_evidence }),
          user_name: user_name ?? null
        })
      }
      if (annotationUpdates.starred !== undefined) {
        db.auditLog.appendEntry({
          action_type: annotationUpdates.starred ? 'star' : 'unstar',
          entity_type: 'case_variant_annotation',
          entity_key: entityKey,
          old_value: oldAnnotation ? JSON.stringify({ starred: oldAnnotation.starred }) : null,
          new_value: JSON.stringify({ starred: annotationUpdates.starred ? 1 : 0 }),
          user_name: user_name ?? null
        })
      }

      return result
    })
  }
)

/**
 * Delete per-case annotation for a variant
 */
ipcMain.handle('annotations:deletePerCase', async (_event, caseId: number, variantId: number) => {
  return wrapHandler(async () => {
    const db = getDatabaseService()
    db.annotations.deletePerCaseAnnotation(caseId, variantId)
    return undefined
  })
})

/**
 * Get all annotations for a variant (global + per-case)
 */
ipcMain.handle(
  'annotations:getForVariant',
  async (_event, caseId: number, chr: string, pos: number, ref: string, alt: string) => {
    return wrapHandler(async () => {
      const db = getDatabaseService()
      return db.annotations.getAnnotationsForVariant(caseId, chr, pos, ref, alt)
    })
  }
)
