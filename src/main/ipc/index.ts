import { ipcMain } from 'electron'
import { getDatabaseService, getDatabaseManager } from '../database'
import { mainLogger } from '../services/MainLogger'
import type { HandlerDependencies } from './types'
import { getDbPool } from './dbPoolManager'

import { registerCaseHandlers } from './handlers/cases'
import { registerVariantHandlers } from './handlers/variants'
import { registerImportHandlers } from './handlers/import'
import { registerSystemHandlers } from './handlers/system'
import { registerExportHandlers } from './handlers/export'
import { registerShellHandlers } from './handlers/shell'
import { registerDatabaseHandlers } from './handlers/database'
import { registerBatchImportHandlers } from './handlers/batch-import'
import { registerCohortHandlers } from './handlers/cohort'
import { registerAnnotationHandlers } from './handlers/annotations'
import { registerVepHandlers } from './handlers/vep'
import { registerHpoHandlers } from './handlers/hpo'
import { registerMyVariantHandlers } from './handlers/myvariant'
import { registerSpliceAIHandlers } from './handlers/spliceai'
import { registerCaseMetadataHandlers } from './handlers/case-metadata'
import { registerCaseCommentHandlers } from './handlers/case-comments'
import { registerCaseMetricHandlers } from './handlers/case-metrics'
import { registerTagHandlers } from './handlers/tags'
import { registerTranscriptHandlers } from './handlers/transcripts'
import { registerUpdaterHandlers } from './handlers/updater'
import { registerAuditLogHandlers } from './handlers/audit-log'
import { registerGeneListHandlers } from './handlers/gene-lists'
import { registerAuthHandlers } from './handlers/auth'
import { registerFilterPresetHandlers } from './handlers/filter-presets'

// Re-export pool lifecycle for external callers (e.g. app shutdown)
export { initDbPool, destroyDbPool } from './dbPoolManager'

/**
 * Register all IPC handlers.
 * Called once during app initialization.
 *
 * Creates shared dependencies and passes them to each handler module's
 * register function, replacing the previous side-effect import pattern.
 */
export function registerIpcHandlers(): void {
  const deps: HandlerDependencies = {
    ipcMain,
    getDb: getDatabaseService,
    getDbManager: getDatabaseManager,
    getDbPool
  }

  registerCaseHandlers(deps)
  registerVariantHandlers(deps)
  registerImportHandlers(deps)
  registerSystemHandlers(deps)
  registerExportHandlers(deps)
  registerShellHandlers(deps)
  registerDatabaseHandlers(deps)
  registerBatchImportHandlers(deps)
  registerCohortHandlers(deps)
  registerAnnotationHandlers(deps)
  registerVepHandlers(deps)
  registerHpoHandlers(deps)
  registerMyVariantHandlers(deps)
  registerSpliceAIHandlers(deps)
  registerCaseMetadataHandlers(deps)
  registerCaseCommentHandlers(deps)
  registerCaseMetricHandlers(deps)
  registerTagHandlers(deps)
  registerTranscriptHandlers(deps)
  registerUpdaterHandlers(deps)
  registerAuditLogHandlers(deps)
  registerGeneListHandlers(deps)
  registerAuthHandlers(deps)
  registerFilterPresetHandlers(deps)

  mainLogger.info('IPC handlers registered', 'ipc')
}
