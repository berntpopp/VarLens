import { wrapHandler } from '../errorHandler'
import type { HandlerDependencies } from '../types'
import {
  PanelCreateSchema,
  PanelUpdateSchema,
  PanelGenesSchema,
  PanelActivateSchema,
  PanelDeactivateSchema,
  ValidateSymbolsSchema,
  AutocompleteSchema,
  PanelDuplicateSchema,
  PanelIdSchema,
  CaseIdSchema,
  PanelAppSearchSchema,
  PanelAppImportSchema,
  StringDbGenerateSchema,
  PanelExportBedSchema
} from '../../../shared/types/ipc-schemas'
import { mainLogger } from '../../services/MainLogger'
import { getGeneReferenceDb } from '../../database/geneReferenceLoader'
import { PanelAppClient } from '../../services/api/PanelAppClient'
import { StringDbClient } from '../../services/api/StringDbClient'
import { clearPanelIntervalCache } from './variants'
import { dialog } from 'electron'
import { writeFile } from 'fs/promises'
import {
  listPanels,
  getPanel,
  createPanel,
  updatePanel,
  deletePanel,
  duplicatePanel,
  setGenes,
  getGenes,
  activatePanel,
  deactivatePanel,
  getActivePanelsForCase,
  validateSymbols,
  autocomplete,
  searchPanelApp,
  importPanelApp,
  generateStringDb,
  generateBedContent
} from './panels-logic'
import type { PanelCacheCallbacks } from './panels-logic'
import {
  importPanelAppForSession,
  generateStringDbForSession,
  generateBedContentForSession
} from './panels-session'

/** Shared cache-clearing callback wired to the variant module's interval cache. */
const cacheCallbacks: PanelCacheCallbacks = {
  clearPanelIntervalCache: () => clearPanelIntervalCache()
}

/**
 * Panel and gene reference IPC handlers
 */
export function registerPanelHandlers({ ipcMain, getDb, getDbManager }: HandlerDependencies): void {
  // ============================================================
  // Panel CRUD
  // ============================================================

  ipcMain.handle('panels:list', async () => {
    return wrapHandler(async () => {
      const session = getDbManager().getCurrentSession()
      if (session.capabilities.backend === 'postgres') {
        return await session.getReadExecutor().execute({ type: 'panels:list', params: [] })
      }
      return listPanels(getDb)
    })
  })

  ipcMain.handle('panels:get', async (_event, id: unknown) => {
    return wrapHandler(async () => {
      const validated = PanelIdSchema.safeParse(id)
      if (!validated.success) {
        mainLogger.error(`Invalid panels:get id: ${validated.error.message}`, 'panels')
        throw new Error('Invalid panel ID')
      }
      const session = getDbManager().getCurrentSession()
      if (session.capabilities.backend === 'postgres') {
        const panel = await session
          .getReadExecutor()
          .execute({ type: 'panels:get', params: [validated.data] })
        const genes = await session
          .getReadExecutor()
          .execute({ type: 'panels:getGenes', params: [validated.data] })
        return panel === null ? null : { ...(panel as object), genes }
      }
      return getPanel(validated.data, getDb)
    })
  })

  ipcMain.handle('panels:create', async (_event, params: unknown) => {
    return wrapHandler(async () => {
      const validated = PanelCreateSchema.safeParse(params)
      if (!validated.success) {
        mainLogger.error(`Invalid panels:create params: ${validated.error.message}`, 'panels')
        throw new Error('Invalid panel parameters')
      }
      const session = getDbManager().getCurrentSession()
      if (session.capabilities.backend === 'postgres') {
        const result = await session
          .getWriteExecutor()
          .execute({ type: 'panels:create', params: [validated.data] })
        cacheCallbacks.clearPanelIntervalCache()
        return result
      }
      return createPanel(validated.data, getDb, cacheCallbacks)
    })
  })

  ipcMain.handle('panels:update', async (_event, params: unknown) => {
    return wrapHandler(async () => {
      const validated = PanelUpdateSchema.safeParse(params)
      if (!validated.success) {
        mainLogger.error(`Invalid panels:update params: ${validated.error.message}`, 'panels')
        throw new Error('Invalid panel update parameters')
      }
      const session = getDbManager().getCurrentSession()
      if (session.capabilities.backend === 'postgres') {
        const result = await session.getWriteExecutor().execute({
          type: 'panels:update',
          params: [
            validated.data.id,
            {
              name: validated.data.name,
              description: validated.data.description,
              version: validated.data.version
            }
          ]
        })
        cacheCallbacks.clearPanelIntervalCache()
        return result
      }
      return updatePanel(validated.data, getDb, cacheCallbacks)
    })
  })

  ipcMain.handle('panels:delete', async (_event, id: unknown) => {
    return wrapHandler(async () => {
      const validated = PanelIdSchema.safeParse(id)
      if (!validated.success) {
        mainLogger.error(`Invalid panels:delete id: ${validated.error.message}`, 'panels')
        throw new Error('Invalid panel ID')
      }
      const session = getDbManager().getCurrentSession()
      if (session.capabilities.backend === 'postgres') {
        await session
          .getWriteExecutor()
          .execute({ type: 'panels:delete', params: [validated.data] })
        cacheCallbacks.clearPanelIntervalCache()
        return undefined
      }
      return deletePanel(validated.data, getDb, cacheCallbacks)
    })
  })

  ipcMain.handle('panels:duplicate', async (_event, params: unknown) => {
    return wrapHandler(async () => {
      const validated = PanelDuplicateSchema.safeParse(params)
      if (!validated.success) {
        mainLogger.error(`Invalid panels:duplicate params: ${validated.error.message}`, 'panels')
        throw new Error('Invalid panel duplicate parameters')
      }
      const session = getDbManager().getCurrentSession()
      if (session.capabilities.backend === 'postgres') {
        return await session.getWriteExecutor().execute({
          type: 'panels:duplicate',
          params: [validated.data.id, validated.data.newName]
        })
      }
      return duplicatePanel(validated.data.id, validated.data.newName, getDb)
    })
  })

  // ============================================================
  // Panel Genes
  // ============================================================

  ipcMain.handle('panels:setGenes', async (_event, params: unknown) => {
    return wrapHandler(async () => {
      const validated = PanelGenesSchema.safeParse(params)
      if (!validated.success) {
        mainLogger.error(`Invalid panels:setGenes params: ${validated.error.message}`, 'panels')
        throw new Error('Invalid panel genes parameters')
      }
      const session = getDbManager().getCurrentSession()
      if (session.capabilities.backend === 'postgres') {
        await session.getWriteExecutor().execute({
          type: 'panels:setGenes',
          params: [validated.data.panelId, validated.data.genes]
        })
        cacheCallbacks.clearPanelIntervalCache()
        return undefined
      }
      return setGenes(validated.data.panelId, validated.data.genes, getDb, cacheCallbacks)
    })
  })

  ipcMain.handle('panels:getGenes', async (_event, panelId: unknown) => {
    return wrapHandler(async () => {
      const validated = PanelIdSchema.safeParse(panelId)
      if (!validated.success) {
        mainLogger.error(`Invalid panels:getGenes panelId: ${validated.error.message}`, 'panels')
        throw new Error('Invalid panel ID')
      }
      const session = getDbManager().getCurrentSession()
      if (session.capabilities.backend === 'postgres') {
        return await session
          .getReadExecutor()
          .execute({ type: 'panels:getGenes', params: [validated.data] })
      }
      return getGenes(validated.data, getDb)
    })
  })

  // ============================================================
  // Panel Activation (per-case)
  // ============================================================

  ipcMain.handle('panels:activate', async (_event, params: unknown) => {
    return wrapHandler(async () => {
      const validated = PanelActivateSchema.safeParse(params)
      if (!validated.success) {
        mainLogger.error(`Invalid panels:activate params: ${validated.error.message}`, 'panels')
        throw new Error('Invalid panel activation parameters')
      }
      const session = getDbManager().getCurrentSession()
      if (session.capabilities.backend === 'postgres') {
        return await session.getWriteExecutor().execute({
          type: 'panels:activate',
          params: [validated.data.caseId, validated.data.panelId, validated.data.paddingBp]
        })
      }
      return activatePanel(
        validated.data.caseId,
        validated.data.panelId,
        validated.data.paddingBp,
        getDb
      )
    })
  })

  ipcMain.handle('panels:deactivate', async (_event, params: unknown) => {
    return wrapHandler(async () => {
      const validated = PanelDeactivateSchema.safeParse(params)
      if (!validated.success) {
        mainLogger.error(`Invalid panels:deactivate params: ${validated.error.message}`, 'panels')
        throw new Error('Invalid panel deactivation parameters')
      }
      const session = getDbManager().getCurrentSession()
      if (session.capabilities.backend === 'postgres') {
        return await session.getWriteExecutor().execute({
          type: 'panels:deactivate',
          params: [validated.data.caseId, validated.data.panelId]
        })
      }
      return deactivatePanel(validated.data.caseId, validated.data.panelId, getDb)
    })
  })

  ipcMain.handle('panels:active-for-case', async (_event, caseId: unknown) => {
    return wrapHandler(async () => {
      const validated = CaseIdSchema.safeParse(caseId)
      if (!validated.success) {
        mainLogger.error(
          `Invalid panels:active-for-case caseId: ${validated.error.message}`,
          'panels'
        )
        throw new Error('Invalid case ID')
      }
      const session = getDbManager().getCurrentSession()
      if (session.capabilities.backend === 'postgres') {
        return await session
          .getReadExecutor()
          .execute({ type: 'panels:activeForCase', params: [validated.data] })
      }
      return getActivePanelsForCase(validated.data, getDb)
    })
  })

  // ============================================================
  // Gene Reference Queries
  // ============================================================

  ipcMain.handle('panels:validate-symbols', async (_event, params: unknown) => {
    return wrapHandler(async () => {
      const validated = ValidateSymbolsSchema.safeParse(params)
      if (!validated.success) {
        mainLogger.error(
          `Invalid panels:validate-symbols params: ${validated.error.message}`,
          'panels'
        )
        throw new Error('Invalid symbol validation parameters')
      }
      const geneRef = getGeneReferenceDb()
      return validateSymbols(validated.data.symbols, geneRef)
    })
  })

  ipcMain.handle('panels:autocomplete', async (_event, params: unknown) => {
    return wrapHandler(async () => {
      const validated = AutocompleteSchema.safeParse(params)
      if (!validated.success) {
        mainLogger.error(`Invalid panels:autocomplete params: ${validated.error.message}`, 'panels')
        throw new Error('Invalid autocomplete parameters')
      }
      const geneRef = getGeneReferenceDb()
      return autocomplete(validated.data.query, validated.data.limit, geneRef)
    })
  })

  // ============================================================
  // PanelApp / StringDB Integration
  // ============================================================

  ipcMain.handle('panels:search-panelapp', async (_event, params: unknown) => {
    return wrapHandler(async () => {
      const validated = PanelAppSearchSchema.safeParse(params)
      if (!validated.success) {
        mainLogger.error(
          `Invalid panels:search-panelapp params: ${validated.error.message}`,
          'panels'
        )
        throw new Error('Invalid PanelApp search parameters')
      }
      const client = new PanelAppClient()
      return searchPanelApp(validated.data.keyword, validated.data.region, client)
    })
  })

  ipcMain.handle('panels:import-panelapp', async (_event, params: unknown) => {
    return wrapHandler(async () => {
      const validated = PanelAppImportSchema.safeParse(params)
      if (!validated.success) {
        mainLogger.error(
          `Invalid panels:import-panelapp params: ${validated.error.message}`,
          'panels'
        )
        throw new Error('Invalid PanelApp import parameters')
      }
      const client = new PanelAppClient()
      const geneRef = getGeneReferenceDb()
      const session = getDbManager().getCurrentSession()
      if (session.capabilities.backend === 'postgres') {
        return importPanelAppForSession(session, validated.data, geneRef, client, cacheCallbacks)
      }
      return importPanelApp(validated.data, getDb, geneRef, client, cacheCallbacks)
    })
  })

  ipcMain.handle('panels:generate-stringdb', async (_event, params: unknown) => {
    return wrapHandler(async () => {
      const validated = StringDbGenerateSchema.safeParse(params)
      if (!validated.success) {
        mainLogger.error(
          `Invalid panels:generate-stringdb params: ${validated.error.message}`,
          'panels'
        )
        throw new Error('Invalid StringDB generation parameters')
      }
      const client = new StringDbClient()
      const geneRef = getGeneReferenceDb()
      const session = getDbManager().getCurrentSession()
      if (session.capabilities.backend === 'postgres') {
        return generateStringDbForSession(session, validated.data, geneRef, client, cacheCallbacks)
      }
      return generateStringDb(validated.data, getDb, geneRef, client, cacheCallbacks)
    })
  })

  // ============================================================
  // BED File Export
  // ============================================================

  ipcMain.handle('panels:export-bed', async (_event, params: unknown) => {
    return wrapHandler(async () => {
      const validated = PanelExportBedSchema.safeParse(params)
      if (!validated.success) {
        mainLogger.error(`Invalid panels:export-bed params: ${validated.error.message}`, 'panels')
        throw new Error('Invalid BED export parameters')
      }

      const { panelId, assembly, paddingBp } = validated.data

      // Generate BED content (pure logic)
      const geneRef = getGeneReferenceDb()
      const session = getDbManager().getCurrentSession()
      const bed =
        session.capabilities.backend === 'postgres'
          ? await generateBedContentForSession(session, panelId, assembly, paddingBp, geneRef)
          : generateBedContent(panelId, assembly, paddingBp, getDb, geneRef)

      // Show save dialog (Electron-specific, stays in handler)
      const { canceled, filePath } = await dialog.showSaveDialog({
        title: 'Export BED File',
        defaultPath: `${bed.panelName.replace(/[^a-zA-Z0-9_-]/g, '_')}_${assembly}.bed`,
        filters: [
          { name: 'BED files', extensions: ['bed'] },
          { name: 'All files', extensions: ['*'] }
        ]
      })

      if (canceled || !filePath) {
        return { success: false, path: undefined }
      }

      // Write BED file (I/O stays in handler)
      await writeFile(filePath, bed.lines.join('\n') + '\n', 'utf-8')

      mainLogger.info(
        `Exported BED file for panel "${bed.panelName}" (${bed.geneCount} genes) to ${filePath}`,
        'panels'
      )

      return { success: true, path: filePath }
    })
  })
}
