import { wrapHandler } from '../errorHandler'
import type { HandlerDependencies } from '../types'
import type { VariantAnnotation, CaseVariantAnnotation } from '../../database/types'
import {
  VariantCoordsSchema,
  GlobalAnnotationUpdatesSchema,
  PerCaseAnnotationUpdatesSchema,
  CaseVariantIdSchema,
  CaseIdSchema
} from '../../../shared/types/ipc-schemas'
import { mainLogger } from '../../services/MainLogger'

/**
 * Annotations IPC handlers
 * Channels: annotations:getGlobal, annotations:upsertGlobal, annotations:getPerCase,
 *           annotations:upsertPerCase, annotations:deleteGlobal, annotations:deletePerCase,
 *           annotations:getForVariant
 */
export function registerAnnotationHandlers({ ipcMain, getDb }: HandlerDependencies): void {
  /**
   * Get global annotation for a variant
   */
  ipcMain.handle(
    'annotations:getGlobal',
    async (_event, chr: unknown, pos: unknown, ref: unknown, alt: unknown) => {
      return wrapHandler(async () => {
        // ANTI-07: Runtime validation at IPC boundary
        const validated = VariantCoordsSchema.safeParse({ chr, pos, ref, alt })
        if (!validated.success) {
          mainLogger.error(
            `Invalid annotations:getGlobal coords: ${validated.error.message}`,
            'annotations'
          )
          throw new Error('Invalid variant coordinates')
        }

        const db = getDb()
        return db.annotations.getGlobalAnnotation(
          validated.data.chr,
          validated.data.pos,
          validated.data.ref,
          validated.data.alt
        )
      })
    }
  )

  /**
   * Upsert global annotation for a variant
   */
  ipcMain.handle(
    'annotations:upsertGlobal',
    async (_event, chr: unknown, pos: unknown, ref: unknown, alt: unknown, updates: unknown) => {
      return wrapHandler(async () => {
        // ANTI-07: Runtime validation at IPC boundary
        const validatedCoords = VariantCoordsSchema.safeParse({ chr, pos, ref, alt })
        if (!validatedCoords.success) {
          mainLogger.error(
            `Invalid annotations:upsertGlobal coords: ${validatedCoords.error.message}`,
            'annotations'
          )
          throw new Error('Invalid variant coordinates')
        }

        const validatedUpdates = GlobalAnnotationUpdatesSchema.safeParse(updates)
        if (!validatedUpdates.success) {
          mainLogger.error(
            `Invalid annotations:upsertGlobal updates: ${validatedUpdates.error.message}`,
            'annotations'
          )
          throw new Error('Invalid annotation updates')
        }

        const db = getDb()
        const { chr: vChr, pos: vPos, ref: vRef, alt: vAlt } = validatedCoords.data

        // Extract user_name before building db updates
        const { user_name, ...annotationUpdates } = validatedUpdates.data

        // Read current state before upsert for audit trail
        const oldAnnotation = db.annotations.getGlobalAnnotation(vChr, vPos, vRef, vAlt)

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

        const result = db.annotations.upsertGlobalAnnotation(vChr, vPos, vRef, vAlt, dbUpdates)

        // Audit logging
        const entityKey = `${vChr}:${vPos}:${vRef}:${vAlt}`
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
    async (_event, chr: unknown, pos: unknown, ref: unknown, alt: unknown) => {
      return wrapHandler(async () => {
        // ANTI-07: Runtime validation at IPC boundary
        const validated = VariantCoordsSchema.safeParse({ chr, pos, ref, alt })
        if (!validated.success) {
          mainLogger.error(
            `Invalid annotations:deleteGlobal coords: ${validated.error.message}`,
            'annotations'
          )
          throw new Error('Invalid variant coordinates')
        }

        const db = getDb()
        db.annotations.deleteGlobalAnnotation(
          validated.data.chr,
          validated.data.pos,
          validated.data.ref,
          validated.data.alt
        )
        return undefined
      })
    }
  )

  /**
   * Get per-case annotation for a variant
   */
  ipcMain.handle('annotations:getPerCase', async (_event, caseId: unknown, variantId: unknown) => {
    return wrapHandler(async () => {
      // ANTI-07: Runtime validation at IPC boundary
      const validated = CaseVariantIdSchema.safeParse({ caseId, variantId })
      if (!validated.success) {
        mainLogger.error(
          `Invalid annotations:getPerCase params: ${validated.error.message}`,
          'annotations'
        )
        throw new Error('Invalid case/variant ID')
      }

      const db = getDb()
      return db.annotations.getPerCaseAnnotation(validated.data.caseId, validated.data.variantId)
    })
  })

  /**
   * Upsert per-case annotation for a variant
   * Handles per_case_comment, starred, acmg_classification, acmg_evidence
   */
  ipcMain.handle(
    'annotations:upsertPerCase',
    async (_event, caseId: unknown, variantId: unknown, updates: unknown) => {
      return wrapHandler(async () => {
        // ANTI-07: Runtime validation at IPC boundary
        const validatedIds = CaseVariantIdSchema.safeParse({ caseId, variantId })
        if (!validatedIds.success) {
          mainLogger.error(
            `Invalid annotations:upsertPerCase ids: ${validatedIds.error.message}`,
            'annotations'
          )
          throw new Error('Invalid case/variant ID')
        }

        const validatedUpdates = PerCaseAnnotationUpdatesSchema.safeParse(updates)
        if (!validatedUpdates.success) {
          mainLogger.error(
            `Invalid annotations:upsertPerCase updates: ${validatedUpdates.error.message}`,
            'annotations'
          )
          throw new Error('Invalid annotation updates')
        }

        const db = getDb()
        const vCaseId = validatedIds.data.caseId
        const vVariantId = validatedIds.data.variantId

        // Extract user_name before building db updates
        const { user_name, ...annotationUpdates } = validatedUpdates.data

        // Read current state before upsert for audit trail
        const oldAnnotation = db.annotations.getPerCaseAnnotation(vCaseId, vVariantId)

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

        const result = db.annotations.upsertPerCaseAnnotation(vCaseId, vVariantId, dbUpdates)

        // Audit logging
        const entityKey = `case:${vCaseId}:variant:${vVariantId}`
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
  ipcMain.handle(
    'annotations:deletePerCase',
    async (_event, caseId: unknown, variantId: unknown) => {
      return wrapHandler(async () => {
        // ANTI-07: Runtime validation at IPC boundary
        const validated = CaseVariantIdSchema.safeParse({ caseId, variantId })
        if (!validated.success) {
          mainLogger.error(
            `Invalid annotations:deletePerCase params: ${validated.error.message}`,
            'annotations'
          )
          throw new Error('Invalid case/variant ID')
        }

        const db = getDb()
        db.annotations.deletePerCaseAnnotation(validated.data.caseId, validated.data.variantId)
        return undefined
      })
    }
  )

  /**
   * Get all annotations for a variant (global + per-case)
   */
  ipcMain.handle(
    'annotations:getForVariant',
    async (_event, caseId: unknown, chr: unknown, pos: unknown, ref: unknown, alt: unknown) => {
      return wrapHandler(async () => {
        // ANTI-07: Runtime validation at IPC boundary
        const validatedCaseId = CaseIdSchema.safeParse(caseId)
        if (!validatedCaseId.success) {
          mainLogger.error(
            `Invalid annotations:getForVariant caseId: ${validatedCaseId.error.message}`,
            'annotations'
          )
          throw new Error('Invalid case ID')
        }

        const validatedCoords = VariantCoordsSchema.safeParse({ chr, pos, ref, alt })
        if (!validatedCoords.success) {
          mainLogger.error(
            `Invalid annotations:getForVariant coords: ${validatedCoords.error.message}`,
            'annotations'
          )
          throw new Error('Invalid variant coordinates')
        }

        const db = getDb()
        return db.annotations.getAnnotationsForVariant(
          validatedCaseId.data,
          validatedCoords.data.chr,
          validatedCoords.data.pos,
          validatedCoords.data.ref,
          validatedCoords.data.alt
        )
      })
    }
  )
}
