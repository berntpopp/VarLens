import { wrapHandler } from '../errorHandler'
import type { HandlerDependencies } from '../types'
import {
  TagIdSchema,
  TagCreateSchema,
  TagUpdateSchema,
  VariantTagAssignSchema,
  VariantTagSetSchema,
  CaseVariantIdSchema
} from '../../../shared/types/ipc-schemas'
import { mainLogger } from '../../services/MainLogger'

/**
 * Tags IPC handlers
 *
 * Channels: tags:list, tags:create, tags:update, tags:delete, tags:getUsageCount,
 *           tags:getVariantTags, tags:assignVariantTag, tags:removeVariantTag, tags:setVariantTags
 */
export function registerTagHandlers({ ipcMain, getDb, getDbPool }: HandlerDependencies): void {
  // ============================================================
  // Tag CRUD Handlers
  // ============================================================

  /**
   * List all tags
   */
  ipcMain.handle('tags:list', async () => {
    return wrapHandler(async () => {
      const pool = getDbPool?.()
      if (pool) {
        return await pool.run({ type: 'tags:list' as const, params: [] })
      }
      const db = getDb()
      return db.tags.listTags()
    })
  })

  /**
   * Create a new tag
   */
  ipcMain.handle('tags:create', async (_event, name: unknown, color: unknown) => {
    return wrapHandler(async () => {
      // ANTI-07: Runtime validation at IPC boundary
      const validated = TagCreateSchema.safeParse({ name, color })
      if (!validated.success) {
        mainLogger.error(`Invalid tags:create params: ${validated.error.message}`, 'tags')
        throw new Error('Invalid tag parameters')
      }

      const db = getDb()
      return db.tags.createTag(validated.data.name, validated.data.color)
    })
  })

  /**
   * Update a tag
   */
  ipcMain.handle('tags:update', async (_event, id: unknown, updates: unknown) => {
    return wrapHandler(async () => {
      // ANTI-07: Runtime validation at IPC boundary
      const validatedId = TagIdSchema.safeParse(id)
      if (!validatedId.success) {
        mainLogger.error(`Invalid tags:update id: ${validatedId.error.message}`, 'tags')
        throw new Error('Invalid tag ID')
      }

      const validatedUpdates = TagUpdateSchema.safeParse(updates)
      if (!validatedUpdates.success) {
        mainLogger.error(`Invalid tags:update updates: ${validatedUpdates.error.message}`, 'tags')
        throw new Error('Invalid tag update parameters')
      }

      const db = getDb()
      return db.tags.updateTag(validatedId.data, validatedUpdates.data)
    })
  })

  /**
   * Delete a tag
   */
  ipcMain.handle('tags:delete', async (_event, id: unknown) => {
    return wrapHandler(async () => {
      // ANTI-07: Runtime validation at IPC boundary
      const validatedId = TagIdSchema.safeParse(id)
      if (!validatedId.success) {
        mainLogger.error(`Invalid tags:delete id: ${validatedId.error.message}`, 'tags')
        throw new Error('Invalid tag ID')
      }

      const db = getDb()
      db.tags.deleteTag(validatedId.data)
      return undefined
    })
  })

  /**
   * Get tag usage count
   */
  ipcMain.handle('tags:getUsageCount', async (_event, tagId: unknown) => {
    return wrapHandler(async () => {
      // ANTI-07: Runtime validation at IPC boundary
      const validatedId = TagIdSchema.safeParse(tagId)
      if (!validatedId.success) {
        mainLogger.error(`Invalid tags:getUsageCount id: ${validatedId.error.message}`, 'tags')
        throw new Error('Invalid tag ID')
      }

      const pool = getDbPool?.()
      if (pool) {
        return await pool.run({ type: 'tags:getUsageCount' as const, params: [validatedId.data] })
      }
      const db = getDb()
      return db.tags.getTagUsageCount(validatedId.data)
    })
  })

  // ============================================================
  // Variant Tag Assignment Handlers
  // ============================================================

  /**
   * Get all tags for a case-variant pair
   */
  ipcMain.handle('tags:getVariantTags', async (_event, caseId: unknown, variantId: unknown) => {
    return wrapHandler(async () => {
      // ANTI-07: Runtime validation at IPC boundary
      const validated = CaseVariantIdSchema.safeParse({ caseId, variantId })
      if (!validated.success) {
        mainLogger.error(`Invalid tags:getVariantTags params: ${validated.error.message}`, 'tags')
        throw new Error('Invalid case/variant ID')
      }

      const pool = getDbPool?.()
      if (pool) {
        return await pool.run({
          type: 'tags:getVariantTags' as const,
          params: [validated.data.caseId, validated.data.variantId]
        })
      }
      const db = getDb()
      return db.tags.getVariantTags(validated.data.caseId, validated.data.variantId)
    })
  })

  /**
   * Assign a tag to a case-variant pair
   */
  ipcMain.handle(
    'tags:assignVariantTag',
    async (_event, caseId: unknown, variantId: unknown, tagId: unknown) => {
      return wrapHandler(async () => {
        // ANTI-07: Runtime validation at IPC boundary
        const validated = VariantTagAssignSchema.safeParse({ caseId, variantId, tagId })
        if (!validated.success) {
          mainLogger.error(
            `Invalid tags:assignVariantTag params: ${validated.error.message}`,
            'tags'
          )
          throw new Error('Invalid tag assignment parameters')
        }

        const db = getDb()
        db.tags.assignVariantTag(
          validated.data.caseId,
          validated.data.variantId,
          validated.data.tagId
        )
        return undefined
      })
    }
  )

  /**
   * Remove a tag from a case-variant pair
   */
  ipcMain.handle(
    'tags:removeVariantTag',
    async (_event, caseId: unknown, variantId: unknown, tagId: unknown) => {
      return wrapHandler(async () => {
        // ANTI-07: Runtime validation at IPC boundary
        const validated = VariantTagAssignSchema.safeParse({ caseId, variantId, tagId })
        if (!validated.success) {
          mainLogger.error(
            `Invalid tags:removeVariantTag params: ${validated.error.message}`,
            'tags'
          )
          throw new Error('Invalid tag removal parameters')
        }

        const db = getDb()
        db.tags.removeVariantTag(
          validated.data.caseId,
          validated.data.variantId,
          validated.data.tagId
        )
        return undefined
      })
    }
  )

  /**
   * Replace all tag assignments for a case-variant pair
   */
  ipcMain.handle(
    'tags:setVariantTags',
    async (_event, caseId: unknown, variantId: unknown, tagIds: unknown) => {
      return wrapHandler(async () => {
        // ANTI-07: Runtime validation at IPC boundary
        const validated = VariantTagSetSchema.safeParse({ caseId, variantId, tagIds })
        if (!validated.success) {
          mainLogger.error(`Invalid tags:setVariantTags params: ${validated.error.message}`, 'tags')
          throw new Error('Invalid tag set parameters')
        }

        const db = getDb()
        db.tags.setVariantTags(
          validated.data.caseId,
          validated.data.variantId,
          validated.data.tagIds
        )
        return undefined
      })
    }
  )
}
