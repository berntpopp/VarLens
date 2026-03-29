import { wrapHandler } from '../errorHandler'
import type { HandlerDependencies } from '../types'
import { readFile } from 'node:fs/promises'
import {
  GeneListIdSchema,
  GeneListCreateSchema,
  GeneListSetGenesSchema,
  RegionFileCreateSchema,
  BedImportSchema
} from '../../../shared/types/ipc-schemas'
import { mainLogger } from '../../services/MainLogger'

/**
 * Gene Lists and Region Files IPC handlers
 */
export function registerGeneListHandlers({ ipcMain, getDb, getDbPool }: HandlerDependencies): void {
  // ============================================================
  // Gene Lists
  // ============================================================

  ipcMain.handle('gene-lists:list', async () => {
    return wrapHandler(async () => {
      const pool = getDbPool?.()
      if (pool) {
        return await pool.run({ type: 'gene-lists:list' as const, params: [] })
      }
      const db = getDb()
      return db.geneLists.listGeneLists()
    })
  })

  ipcMain.handle('gene-lists:create', async (_event, name: unknown, description?: unknown) => {
    return wrapHandler(async () => {
      // ANTI-07: Runtime validation at IPC boundary
      const validated = GeneListCreateSchema.safeParse({ name, description })
      if (!validated.success) {
        mainLogger.error(
          `Invalid gene-lists:create params: ${validated.error.message}`,
          'gene-lists'
        )
        throw new Error('Invalid gene list parameters')
      }

      const db = getDb()
      return db.geneLists.createGeneList(validated.data.name, validated.data.description)
    })
  })

  ipcMain.handle('gene-lists:delete', async (_event, id: unknown) => {
    return wrapHandler(async () => {
      // ANTI-07: Runtime validation at IPC boundary
      const validated = GeneListIdSchema.safeParse(id)
      if (!validated.success) {
        mainLogger.error(`Invalid gene-lists:delete id: ${validated.error.message}`, 'gene-lists')
        throw new Error('Invalid gene list ID')
      }

      const db = getDb()
      db.geneLists.deleteGeneList(validated.data)
      return undefined
    })
  })

  ipcMain.handle('gene-lists:getGenes', async (_event, listId: unknown) => {
    return wrapHandler(async () => {
      // ANTI-07: Runtime validation at IPC boundary
      const validated = GeneListIdSchema.safeParse(listId)
      if (!validated.success) {
        mainLogger.error(
          `Invalid gene-lists:getGenes listId: ${validated.error.message}`,
          'gene-lists'
        )
        throw new Error('Invalid gene list ID')
      }

      const pool = getDbPool?.()
      if (pool) {
        return await pool.run({ type: 'gene-lists:getGenes' as const, params: [validated.data] })
      }
      const db = getDb()
      return db.geneLists.getGeneListGenes(validated.data)
    })
  })

  ipcMain.handle('gene-lists:setGenes', async (_event, listId: unknown, genes: unknown) => {
    return wrapHandler(async () => {
      // ANTI-07: Runtime validation at IPC boundary
      const validated = GeneListSetGenesSchema.safeParse({ listId, genes })
      if (!validated.success) {
        mainLogger.error(
          `Invalid gene-lists:setGenes params: ${validated.error.message}`,
          'gene-lists'
        )
        throw new Error('Invalid gene list parameters')
      }

      const db = getDb()
      db.geneLists.setGeneListGenes(validated.data.listId, validated.data.genes)
      return db.geneLists.getGeneListGenes(validated.data.listId)
    })
  })

  // ============================================================
  // Region Files (BED)
  // ============================================================

  ipcMain.handle('region-files:list', async () => {
    return wrapHandler(async () => {
      const pool = getDbPool?.()
      if (pool) {
        return await pool.run({ type: 'region-files:list' as const, params: [] })
      }
      const db = getDb()
      return db.geneLists.listRegionFiles()
    })
  })

  ipcMain.handle('region-files:create', async (_event, name: unknown, description: unknown) => {
    return wrapHandler(async () => {
      // ANTI-07: Runtime validation at IPC boundary
      const validated = RegionFileCreateSchema.safeParse({ name, description })
      if (!validated.success) {
        mainLogger.error(
          `Invalid region-files:create params: ${validated.error.message}`,
          'gene-lists'
        )
        throw new Error('Invalid region file parameters')
      }

      const db = getDb()
      return db.geneLists.createRegionFile(validated.data.name, validated.data.description ?? null)
    })
  })

  ipcMain.handle('region-files:delete', async (_event, id: unknown) => {
    return wrapHandler(async () => {
      // ANTI-07: Runtime validation at IPC boundary
      const validated = GeneListIdSchema.safeParse(id)
      if (!validated.success) {
        mainLogger.error(`Invalid region-files:delete id: ${validated.error.message}`, 'gene-lists')
        throw new Error('Invalid region file ID')
      }

      const db = getDb()
      db.geneLists.deleteRegionFile(validated.data)
      return undefined
    })
  })

  ipcMain.handle('region-files:importBed', async (_event, fileId: unknown, filePath: unknown) => {
    return wrapHandler(async () => {
      // ANTI-07: Runtime validation at IPC boundary
      const validated = BedImportSchema.safeParse({ fileId, filePath })
      if (!validated.success) {
        mainLogger.error(
          `Invalid region-files:importBed params: ${validated.error.message}`,
          'gene-lists'
        )
        throw new Error('Invalid BED import parameters')
      }

      const content = await readFile(validated.data.filePath, 'utf-8')
      const entries: Array<{ chr: string; start: number; end: number; label?: string }> = []

      for (const line of content.split('\n')) {
        const trimmed = line.trim()
        if (
          trimmed === '' ||
          trimmed.startsWith('#') ||
          trimmed.startsWith('browser') ||
          trimmed.startsWith('track')
        ) {
          continue
        }
        const parts = trimmed.split('\t')
        if (parts.length >= 3) {
          const start = parseInt(parts[1], 10)
          const end = parseInt(parts[2], 10)
          if (!isNaN(start) && !isNaN(end)) {
            entries.push({
              chr: parts[0],
              start,
              end,
              label: parts.length >= 4 ? parts[3] : undefined
            })
          }
        }
      }

      const db = getDb()
      return db.geneLists.importBedEntries(validated.data.fileId, entries)
    })
  })
}
