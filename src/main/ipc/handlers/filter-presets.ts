import { wrapHandler } from '../errorHandler'
import type { HandlerDependencies } from '../types'
import {
  FilterPresetIdSchema,
  FilterPresetCreateSchema,
  FilterPresetUpdateSchema,
  FilterPresetReorderSchema
} from '../../../shared/types/ipc-schemas'
import { mainLogger } from '../../services/MainLogger'

/**
 * Filter preset IPC handlers
 *
 * Channels: presets:list, presets:create, presets:update, presets:delete, presets:reorder
 */
export function registerFilterPresetHandlers({ ipcMain, getDb }: HandlerDependencies): void {
  ipcMain.handle('presets:list', async () => {
    return wrapHandler(async () => {
      const db = getDb()
      return db.filterPresets.listPresets()
    })
  })

  ipcMain.handle('presets:create', async (_event, params: unknown) => {
    return wrapHandler(async () => {
      const validated = FilterPresetCreateSchema.safeParse(params)
      if (!validated.success) {
        mainLogger.error(`Invalid presets:create params: ${validated.error.message}`, 'presets')
        throw new Error('Invalid preset parameters')
      }
      const db = getDb()
      return db.filterPresets.createPreset(validated.data)
    })
  })

  ipcMain.handle('presets:update', async (_event, id: unknown, updates: unknown) => {
    return wrapHandler(async () => {
      const validatedId = FilterPresetIdSchema.safeParse(id)
      if (!validatedId.success) {
        mainLogger.error(`Invalid presets:update id: ${validatedId.error.message}`, 'presets')
        throw new Error('Invalid preset ID')
      }
      const validatedUpdates = FilterPresetUpdateSchema.safeParse(updates)
      if (!validatedUpdates.success) {
        mainLogger.error(
          `Invalid presets:update params: ${validatedUpdates.error.message}`,
          'presets'
        )
        throw new Error('Invalid preset update parameters')
      }
      const db = getDb()
      return db.filterPresets.updatePreset(validatedId.data, validatedUpdates.data)
    })
  })

  ipcMain.handle('presets:delete', async (_event, id: unknown) => {
    return wrapHandler(async () => {
      const validatedId = FilterPresetIdSchema.safeParse(id)
      if (!validatedId.success) {
        mainLogger.error(`Invalid presets:delete id: ${validatedId.error.message}`, 'presets')
        throw new Error('Invalid preset ID')
      }
      const db = getDb()
      db.filterPresets.deletePreset(validatedId.data)
      return undefined
    })
  })

  ipcMain.handle('presets:reorder', async (_event, items: unknown) => {
    return wrapHandler(async () => {
      const validated = FilterPresetReorderSchema.safeParse(items)
      if (!validated.success) {
        mainLogger.error(`Invalid presets:reorder params: ${validated.error.message}`, 'presets')
        throw new Error('Invalid reorder parameters')
      }
      const db = getDb()
      db.filterPresets.reorderPresets(validated.data)
      return undefined
    })
  })
}
