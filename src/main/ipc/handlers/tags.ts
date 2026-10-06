import { wrapHandler } from '../errorHandler'
import type { HandlerDependencies } from '../types'
import {
  TagIdSchema,
  TagCreateSchema,
  TagUpdateSchema,
  VariantTagAssignSchema,
  VariantTagSetSchema,
  TagCaseVariantIdSchema
} from '../../../shared/api/schemas/tags'
import { mainLogger } from '../../services/MainLogger'
import type { AuditAppendParams } from '../../storage/audit-log-types'
import type { StorageWriteExecutor } from '../../storage/write-executor'
import { listTags, getUsageCount, getVariantTags } from './tags-logic'

async function appendTagAudit(
  writeExecutor: StorageWriteExecutor,
  params: AuditAppendParams
): Promise<void> {
  await writeExecutor.execute({ type: 'audit:append', params: [params] })
}

/**
 * Tags IPC handlers
 *
 * Channels: tags:list, tags:create, tags:update, tags:delete, tags:getUsageCount,
 *           tags:getVariantTags, tags:assignVariantTag, tags:removeVariantTag, tags:setVariantTags
 */
export function registerTagHandlers({
  ipcMain,
  getDb,
  getDbPool,
  getDbManager
}: HandlerDependencies): void {
  // ============================================================
  // Tag CRUD Handlers
  // ============================================================

  ipcMain.handle('tags:list', async () => {
    return wrapHandler(async () => {
      const session = getDbManager().getCurrentSession()
      if (session.capabilities.backend === 'postgres') {
        return await session.getReadExecutor().execute({ type: 'tags:list', params: [] })
      }
      return listTags(getDb, getDbPool)
    })
  })

  ipcMain.handle('tags:create', async (_event, name: unknown, color: unknown) => {
    return wrapHandler(async () => {
      const validated = TagCreateSchema.safeParse({ name, color })
      if (!validated.success) {
        mainLogger.error(`Invalid tags:create params: ${validated.error.message}`, 'tags')
        throw new Error('Invalid tag parameters')
      }
      // Both backends write through the session executor (SQLite: the
      // dedicated writer thread, never the Electron main thread).
      return await getDbManager()
        .getCurrentSession()
        .getWriteExecutor()
        .execute({ type: 'tags:create', params: [validated.data.name, validated.data.color] })
    })
  })

  ipcMain.handle('tags:update', async (_event, id: unknown, updates: unknown) => {
    return wrapHandler(async () => {
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
      return await getDbManager()
        .getCurrentSession()
        .getWriteExecutor()
        .execute({ type: 'tags:update', params: [validatedId.data, validatedUpdates.data] })
    })
  })

  ipcMain.handle('tags:delete', async (_event, id: unknown) => {
    return wrapHandler(async () => {
      const validatedId = TagIdSchema.safeParse(id)
      if (!validatedId.success) {
        mainLogger.error(`Invalid tags:delete id: ${validatedId.error.message}`, 'tags')
        throw new Error('Invalid tag ID')
      }
      await getDbManager()
        .getCurrentSession()
        .getWriteExecutor()
        .execute({ type: 'tags:delete', params: [validatedId.data] })
      return undefined
    })
  })

  ipcMain.handle('tags:getUsageCount', async (_event, tagId: unknown) => {
    return wrapHandler(async () => {
      const validatedId = TagIdSchema.safeParse(tagId)
      if (!validatedId.success) {
        mainLogger.error(`Invalid tags:getUsageCount id: ${validatedId.error.message}`, 'tags')
        throw new Error('Invalid tag ID')
      }
      const session = getDbManager().getCurrentSession()
      if (session.capabilities.backend === 'postgres') {
        return await session
          .getReadExecutor()
          .execute({ type: 'tags:getUsageCount', params: [validatedId.data] })
      }
      return getUsageCount(validatedId.data, getDb, getDbPool)
    })
  })

  // ============================================================
  // Variant Tag Assignment Handlers
  // ============================================================

  ipcMain.handle('tags:getVariantTags', async (_event, caseId: unknown, variantId: unknown) => {
    return wrapHandler(async () => {
      const validated = TagCaseVariantIdSchema.safeParse({ caseId, variantId })
      if (!validated.success) {
        mainLogger.error(`Invalid tags:getVariantTags params: ${validated.error.message}`, 'tags')
        throw new Error('Invalid case/variant ID')
      }
      const session = getDbManager().getCurrentSession()
      if (session.capabilities.backend === 'postgres') {
        return await session.getReadExecutor().execute({
          type: 'tags:getVariantTags',
          params: [validated.data.caseId, validated.data.variantId]
        })
      }
      return getVariantTags(validated.data.caseId, validated.data.variantId, getDb, getDbPool)
    })
  })

  ipcMain.handle(
    'tags:assignVariantTag',
    async (_event, caseId: unknown, variantId: unknown, tagId: unknown) => {
      return wrapHandler(async () => {
        const validated = VariantTagAssignSchema.safeParse({ caseId, variantId, tagId })
        if (!validated.success) {
          mainLogger.error(
            `Invalid tags:assignVariantTag params: ${validated.error.message}`,
            'tags'
          )
          throw new Error('Invalid tag assignment parameters')
        }
        const session = getDbManager().getCurrentSession()
        const writeExecutor = session.getWriteExecutor()
        await writeExecutor.execute({
          type: 'tags:assignVariantTag',
          params: [validated.data.caseId, validated.data.variantId, validated.data.tagId]
        })
        // Tag audit rows are a PostgreSQL-only behaviour today.
        if (session.capabilities.backend === 'postgres') {
          await appendTagAudit(writeExecutor, {
            action_type: 'tag_assign',
            entity_type: 'case_variant_annotation',
            entity_key: `case:${validated.data.caseId}:variant:${validated.data.variantId}`,
            old_value: null,
            new_value: JSON.stringify({ tag_id: validated.data.tagId })
          })
        }
        return undefined
      })
    }
  )

  ipcMain.handle(
    'tags:removeVariantTag',
    async (_event, caseId: unknown, variantId: unknown, tagId: unknown) => {
      return wrapHandler(async () => {
        const validated = VariantTagAssignSchema.safeParse({ caseId, variantId, tagId })
        if (!validated.success) {
          mainLogger.error(
            `Invalid tags:removeVariantTag params: ${validated.error.message}`,
            'tags'
          )
          throw new Error('Invalid tag removal parameters')
        }
        const session = getDbManager().getCurrentSession()
        const writeExecutor = session.getWriteExecutor()
        await writeExecutor.execute({
          type: 'tags:removeVariantTag',
          params: [validated.data.caseId, validated.data.variantId, validated.data.tagId]
        })
        // Tag audit rows are a PostgreSQL-only behaviour today.
        if (session.capabilities.backend === 'postgres') {
          await appendTagAudit(writeExecutor, {
            action_type: 'tag_remove',
            entity_type: 'case_variant_annotation',
            entity_key: `case:${validated.data.caseId}:variant:${validated.data.variantId}`,
            old_value: JSON.stringify({ tag_id: validated.data.tagId }),
            new_value: null
          })
        }
        return undefined
      })
    }
  )

  ipcMain.handle(
    'tags:setVariantTags',
    async (_event, caseId: unknown, variantId: unknown, tagIds: unknown) => {
      return wrapHandler(async () => {
        const validated = VariantTagSetSchema.safeParse({ caseId, variantId, tagIds })
        if (!validated.success) {
          mainLogger.error(`Invalid tags:setVariantTags params: ${validated.error.message}`, 'tags')
          throw new Error('Invalid tag set parameters')
        }
        await getDbManager()
          .getCurrentSession()
          .getWriteExecutor()
          .execute({
            type: 'tags:setVariantTags',
            params: [validated.data.caseId, validated.data.variantId, validated.data.tagIds]
          })
        return undefined
      })
    }
  )
}
