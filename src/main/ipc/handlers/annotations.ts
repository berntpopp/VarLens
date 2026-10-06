import { BrowserWindow } from 'electron'
import { z } from 'zod'
import { wrapHandler } from '../errorHandler'
import type { HandlerDependencies } from '../types'
import { CaseIdSchema } from '../../../shared/types/ipc-schemas'
import {
  VariantCoordsSchema,
  GlobalAnnotationUpdatesSchema,
  PerCaseAnnotationUpdatesSchema,
  CaseVariantIdSchema
} from '../../../shared/api/schemas/annotations'
import { mainLogger } from '../../services/MainLogger'
import type { AnnotationChangeEvent } from '../../../shared/types/api'
import {
  getGlobalAnnotation,
  upsertGlobalAnnotationViaSession,
  getPerCaseAnnotation,
  upsertPerCaseAnnotationWithEvent,
  getAnnotationsForVariant,
  batchGetAnnotations
} from './annotations-logic'

/**
 * Broadcast a `variants:annotationChanged` event to every non-destroyed
 * renderer window. Called AFTER a successful per-case annotation upsert so
 * that dependent views (e.g. the Wave 4 Shortlist tab) can refetch.
 *
 * Handler-layer only — `annotations-logic.ts` is prohibited from touching
 * Electron APIs per its module JSDoc.
 */
function broadcastAnnotationChanged(ev: AnnotationChangeEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('variants:annotationChanged', ev)
    }
  }
}

/**
 * Annotations IPC handlers
 * Channels: annotations:getGlobal, annotations:upsertGlobal, annotations:getPerCase,
 *           annotations:upsertPerCase, annotations:deleteGlobal, annotations:deletePerCase,
 *           annotations:getForVariant
 */
export function registerAnnotationHandlers({
  ipcMain,
  getDb,
  getDbPool,
  getDbManager
}: HandlerDependencies): void {
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

        const session = getDbManager().getCurrentSession()
        if (session.capabilities.backend === 'postgres') {
          return await session
            .getReadExecutor()
            .execute({ type: 'annotations:getGlobal', params: [validated.data] })
        }
        return getGlobalAnnotation(validated.data, getDb, getDbPool)
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

        return await upsertGlobalAnnotationViaSession(
          validatedCoords.data,
          validatedUpdates.data,
          () => getDbManager().getCurrentSession()
        )
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

        const session = getDbManager().getCurrentSession()
        await session
          .getWriteExecutor()
          .execute({ type: 'annotations:deleteGlobal', params: [validated.data] })
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

      const session = getDbManager().getCurrentSession()
      if (session.capabilities.backend === 'postgres') {
        return await session.getReadExecutor().execute({
          type: 'annotations:getPerCase',
          params: [validated.data.caseId, validated.data.variantId]
        })
      }
      return getPerCaseAnnotation(validated.data.caseId, validated.data.variantId, getDb, getDbPool)
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

        // Broadcast AFTER the logic-layer write succeeds. If the execute call
        // throws, `wrapHandler` catches it and the callback never runs — the
        // error path must not emit the event (Wave 1.E spec §6).
        return await upsertPerCaseAnnotationWithEvent(
          validatedIds.data.caseId,
          validatedIds.data.variantId,
          validatedUpdates.data,
          () => getDbManager().getCurrentSession(),
          broadcastAnnotationChanged
        )
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

        const session = getDbManager().getCurrentSession()
        await session.getWriteExecutor().execute({
          type: 'annotations:deletePerCase',
          params: [validated.data.caseId, validated.data.variantId]
        })
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

        const session = getDbManager().getCurrentSession()
        if (session.capabilities.backend === 'postgres') {
          return await session.getReadExecutor().execute({
            type: 'annotations:getForVariant',
            params: [validatedCaseId.data, validatedCoords.data]
          })
        }
        return getAnnotationsForVariant(
          validatedCaseId.data,
          validatedCoords.data,
          getDb,
          getDbPool
        )
      })
    }
  )

  // Zod schema for batch annotation variant keys (hoisted to avoid re-creation per call)
  const VariantKeysSchema = z.array(
    z.object({
      chr: z.string().min(1),
      pos: z.number().int().positive(),
      ref: z.string().min(1),
      alt: z.string().min(1),
      variantId: z.number().int().positive().optional()
    })
  )

  // Batch read -- single round-trip for N variants (pool-dispatched)
  ipcMain.handle('annotations:batchGet', async (_event, caseId: unknown, variantKeys: unknown) => {
    return wrapHandler(async () => {
      const validatedCaseId = z.number().int().positive().nullable().safeParse(caseId)
      if (!validatedCaseId.success) {
        throw new Error('Invalid caseId parameter')
      }

      const validatedKeys = VariantKeysSchema.safeParse(variantKeys)
      if (!validatedKeys.success) {
        throw new Error('Invalid variantKeys parameter')
      }

      const session = getDbManager().getCurrentSession()
      if (session.capabilities.backend === 'postgres') {
        return await session.getReadExecutor().execute({
          type: 'annotations:batchGet',
          params: [validatedCaseId.data, validatedKeys.data]
        })
      }
      return batchGetAnnotations(validatedCaseId.data, validatedKeys.data, getDb, getDbPool)
    })
  })
}
