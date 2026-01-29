import { ipcMain } from 'electron'
import { wrapHandler } from '../errorHandler'
import { getDatabaseService } from '../../database'

/**
 * Tags IPC handlers
 *
 * Channels: tags:list, tags:create, tags:update, tags:delete, tags:getUsageCount,
 *           tags:getVariantTags, tags:assignVariantTag, tags:removeVariantTag, tags:setVariantTags
 */

// ============================================================
// Tag CRUD Handlers
// ============================================================

/**
 * List all tags
 */
ipcMain.handle('tags:list', async () => {
  return wrapHandler(async () => {
    const db = getDatabaseService()
    return db.listTags()
  })
})

/**
 * Create a new tag
 */
ipcMain.handle('tags:create', async (_event, name: string, color: string) => {
  return wrapHandler(async () => {
    const db = getDatabaseService()
    return db.createTag(name, color)
  })
})

/**
 * Update a tag
 */
ipcMain.handle(
  'tags:update',
  async (_event, id: number, updates: { name?: string; color?: string }) => {
    return wrapHandler(async () => {
      const db = getDatabaseService()
      return db.updateTag(id, updates)
    })
  }
)

/**
 * Delete a tag
 */
ipcMain.handle('tags:delete', async (_event, id: number) => {
  return wrapHandler(async () => {
    const db = getDatabaseService()
    db.deleteTag(id)
    return undefined
  })
})

/**
 * Get tag usage count
 */
ipcMain.handle('tags:getUsageCount', async (_event, tagId: number) => {
  return wrapHandler(async () => {
    const db = getDatabaseService()
    return db.getTagUsageCount(tagId)
  })
})

// ============================================================
// Variant Tag Assignment Handlers
// ============================================================

/**
 * Get all tags for a case-variant pair
 */
ipcMain.handle('tags:getVariantTags', async (_event, caseId: number, variantId: number) => {
  return wrapHandler(async () => {
    const db = getDatabaseService()
    return db.getVariantTags(caseId, variantId)
  })
})

/**
 * Assign a tag to a case-variant pair
 */
ipcMain.handle(
  'tags:assignVariantTag',
  async (_event, caseId: number, variantId: number, tagId: number) => {
    return wrapHandler(async () => {
      const db = getDatabaseService()
      db.assignVariantTag(caseId, variantId, tagId)
      return undefined
    })
  }
)

/**
 * Remove a tag from a case-variant pair
 */
ipcMain.handle(
  'tags:removeVariantTag',
  async (_event, caseId: number, variantId: number, tagId: number) => {
    return wrapHandler(async () => {
      const db = getDatabaseService()
      db.removeVariantTag(caseId, variantId, tagId)
      return undefined
    })
  }
)

/**
 * Replace all tag assignments for a case-variant pair
 */
ipcMain.handle(
  'tags:setVariantTags',
  async (_event, caseId: number, variantId: number, tagIds: number[]) => {
    return wrapHandler(async () => {
      const db = getDatabaseService()
      db.setVariantTags(caseId, variantId, tagIds)
      return undefined
    })
  }
)
