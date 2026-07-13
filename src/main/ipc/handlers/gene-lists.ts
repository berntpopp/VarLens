import { wrapHandler } from '../errorHandler'
import { InvalidParametersError } from '../errors'
import type { HandlerDependencies } from '../types'
import {
  GeneListIdSchema,
  GeneListCreateSchema,
  GeneListSetGenesSchema,
  RegionFileCreateSchema,
  BedImportSchema
} from '../../../shared/types/ipc-schemas'
import { mainLogger } from '../../services/MainLogger'
import { isStrictlyEnrolledPath } from '../../security/import-path-allowlist'

/**
 * Gene Lists and Region Files IPC handlers
 */
export function registerGeneListHandlers({
  ipcMain,
  getDb,
  getDbPool,
  getDbManager
}: HandlerDependencies): void {
  // ============================================================
  // Gene Lists
  // ============================================================

  ipcMain.handle('gene-lists:list', async () => {
    return wrapHandler(async () => {
      const session = getDbManager().getCurrentSession()
      if (session.capabilities.backend === 'postgres') {
        return await session.getReadExecutor().execute({ type: 'gene-lists:list', params: [] })
      }
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

      const session = getDbManager().getCurrentSession()
      if (session.capabilities.backend === 'postgres') {
        return await session.getWriteExecutor().execute({
          type: 'gene-lists:create',
          params: [validated.data.name, validated.data.description]
        })
      }
      return getDb().geneLists.createGeneList(validated.data.name, validated.data.description)
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

      const session = getDbManager().getCurrentSession()
      if (session.capabilities.backend === 'postgres') {
        await session
          .getWriteExecutor()
          .execute({ type: 'gene-lists:delete', params: [validated.data] })
        return undefined
      }
      getDb().geneLists.deleteGeneList(validated.data)
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

      const session = getDbManager().getCurrentSession()
      if (session.capabilities.backend === 'postgres') {
        return await session
          .getReadExecutor()
          .execute({ type: 'gene-lists:getGenes', params: [validated.data] })
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

      const session = getDbManager().getCurrentSession()
      if (session.capabilities.backend === 'postgres') {
        await session.getWriteExecutor().execute({
          type: 'gene-lists:setGenes',
          params: [validated.data.listId, validated.data.genes]
        })
        return await session
          .getReadExecutor()
          .execute({ type: 'gene-lists:getGenes', params: [validated.data.listId] })
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
      const session = getDbManager().getCurrentSession()
      if (session.capabilities.backend === 'postgres') {
        return await session.getReadExecutor().execute({ type: 'region-files:list', params: [] })
      }
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

      const session = getDbManager().getCurrentSession()
      if (session.capabilities.backend === 'postgres') {
        return await session.getWriteExecutor().execute({
          type: 'region-files:create',
          params: [validated.data.name, validated.data.description ?? null]
        })
      }
      return getDb().geneLists.createRegionFile(
        validated.data.name,
        validated.data.description ?? null
      )
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

      const session = getDbManager().getCurrentSession()
      if (session.capabilities.backend === 'postgres') {
        await session
          .getWriteExecutor()
          .execute({ type: 'region-files:delete', params: [validated.data] })
        return undefined
      }
      getDb().geneLists.deleteRegionFile(validated.data)
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

      if (!isStrictlyEnrolledPath(validated.data.filePath)) {
        throw new InvalidParametersError(
          `region-files:importBed: filePath is not in the allowed import paths: ${validated.data.filePath}`,
          'The selected file is not in an allowed location.'
        )
      }
      const session = getDbManager().getCurrentSession()
      return await session.getWriteExecutor().execute({
        type: 'region-files:importBed',
        params: [validated.data.fileId, validated.data.filePath, { rejectMalformedRows: false }]
      })
    })
  })
}
