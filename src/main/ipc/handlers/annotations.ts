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
}

// Type for per-case annotation updates from renderer
interface PerCaseAnnotationUpdates {
  per_case_comment?: string | null
  starred?: boolean
  acmg_classification?: CaseVariantAnnotation['acmg_classification']
  acmg_evidence?: string | null
}

/**
 * Get global annotation for a variant
 */
ipcMain.handle(
  'annotations:getGlobal',
  async (_event, chr: string, pos: number, ref: string, alt: string) => {
    return wrapHandler(async () => {
      const db = getDatabaseService()
      return db.getGlobalAnnotation(chr, pos, ref, alt)
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

      // Convert boolean starred to 0/1 for SQLite INTEGER column
      const dbUpdates: Partial<
        Pick<
          VariantAnnotation,
          'global_comment' | 'starred' | 'acmg_classification' | 'acmg_evidence'
        >
      > = {
        global_comment: updates.global_comment,
        acmg_classification: updates.acmg_classification,
        acmg_evidence: updates.acmg_evidence
      }

      if (updates.starred !== undefined) {
        dbUpdates.starred = updates.starred ? 1 : 0
      }

      return db.upsertGlobalAnnotation(chr, pos, ref, alt, dbUpdates)
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
      db.deleteGlobalAnnotation(chr, pos, ref, alt)
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
    return db.getPerCaseAnnotation(caseId, variantId)
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

      const dbUpdates: Partial<
        Pick<
          CaseVariantAnnotation,
          'per_case_comment' | 'starred' | 'acmg_classification' | 'acmg_evidence'
        >
      > = {
        per_case_comment: updates.per_case_comment,
        acmg_classification: updates.acmg_classification,
        acmg_evidence: updates.acmg_evidence
      }

      // Convert boolean starred to 0/1 for SQLite INTEGER column
      if (updates.starred !== undefined) {
        dbUpdates.starred = updates.starred ? 1 : 0
      }

      return db.upsertPerCaseAnnotation(caseId, variantId, dbUpdates)
    })
  }
)

/**
 * Delete per-case annotation for a variant
 */
ipcMain.handle('annotations:deletePerCase', async (_event, caseId: number, variantId: number) => {
  return wrapHandler(async () => {
    const db = getDatabaseService()
    db.deletePerCaseAnnotation(caseId, variantId)
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
      return db.getAnnotationsForVariant(caseId, chr, pos, ref, alt)
    })
  }
)
