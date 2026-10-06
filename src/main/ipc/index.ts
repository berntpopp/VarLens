import { ipcMain as rawIpcMain } from 'electron'
import { gateIpcMainOnDatabaseStartup } from '../database/startup-gate'
import { mainLogger } from '../services/MainLogger'
import type { HandlerDependencies } from './types'
import { getDatabaseService, getDatabaseManager } from '../database'
import { getDbPool, setActiveSessionResolver } from './dbPoolManager'

// Domain-module registrations (one per WindowAPI top-level key)
import { registerAnalysisGroupsDomain } from './domains/analysis-groups'
import { registerAnnotationsDomain } from './domains/annotations'
import { registerAuditLogDomain } from './domains/audit-log'
import { registerAuthDomain } from './domains/auth'
import { registerBatchImportDomain } from './domains/batch-import'
import { registerCaseCommentsDomain } from './domains/case-comments'
import { registerCaseMetadataDomain } from './domains/case-metadata'
import { registerCaseMetricsDomain } from './domains/case-metrics'
import { registerCasesDomain } from './domains/cases'
import { registerCohortDomain } from './domains/cohort'
import { registerDatabaseDomain } from './domains/database'
import { registerDebugHandlers } from './domains/debug'
import { registerExportDomain } from './domains/export'
import { registerFilterPresetsDomain } from './domains/filter-presets'
import { registerGeneListsDomain } from './domains/gene-lists'
import { registerGeneRefDomain } from './domains/gene-ref'
import { registerGnomadDomain } from './domains/gnomad'
import { registerHpoDomain } from './domains/hpo'
import { registerReferenceServicesDomain } from './domains/reference-services'
import { registerImportDomain } from './domains/import'
import { registerJobsHandlers } from './domains/jobs'
import { registerMyvariantDomain } from './domains/myvariant'
import { registerPanelsDomain } from './domains/panels'
import { registerProteinDomain } from './domains/protein'
import { registerRegionFilesDomain } from './domains/region-files'
import { registerSpliceaiDomain } from './domains/spliceai'
import { registerTagsDomain } from './domains/tags'
import { registerTranscriptsDomain } from './domains/transcripts'
import { registerVariantsDomain } from './domains/variants'
import { registerVepDomain } from './domains/vep'

// Handlers not yet wrapped in a domain module (intentionally on the legacy
// flat-registration shape). These were "closed from start" in the
// 2026-04-16 IPC domain inventory and do not expose a shared contract.
import { registerShellHandlers } from './handlers/shell'
import { registerShortlistHandlers } from './handlers/shortlist'
import { registerSystemHandlers } from './handlers/system'
import { registerUpdaterHandlers } from './handlers/updater'

// Re-export pool lifecycle for external callers (e.g. app shutdown)
export { initDbPool, destroyDbPool } from './dbPoolManager'

/**
 * Register all IPC handlers.
 * Called once during app initialization.
 *
 * Domain-module registrations take only `ipcMain` — they resolve their own
 * dependencies internally. Legacy flat handlers still take the shared
 * `HandlerDependencies` shape.
 */
export function registerIpcHandlers(): void {
  // Handlers are registered before the default database is opened (the
  // window is shown first); every invoke waits for the startup gate.
  const ipcMain = gateIpcMainOnDatabaseStartup(rawIpcMain)

  setActiveSessionResolver(() => {
    try {
      return getDatabaseManager().getCurrentSession()
    } catch {
      return null
    }
  })

  const deps: HandlerDependencies = {
    ipcMain,
    getDb: getDatabaseService,
    getDbManager: getDatabaseManager,
    getDbPool
  }

  // Domain modules (alphabetical)
  registerAnalysisGroupsDomain(ipcMain)
  registerAnnotationsDomain(ipcMain)
  registerAuditLogDomain(ipcMain)
  registerAuthDomain(ipcMain)
  registerBatchImportDomain(ipcMain)
  registerCaseCommentsDomain(ipcMain)
  registerCaseMetadataDomain(ipcMain)
  registerCaseMetricsDomain(ipcMain)
  registerCasesDomain(ipcMain)
  registerCohortDomain(ipcMain)
  registerDatabaseDomain(ipcMain)
  registerDebugHandlers()
  registerExportDomain(ipcMain)
  registerFilterPresetsDomain(ipcMain)
  registerGeneListsDomain(ipcMain)
  registerGeneRefDomain(ipcMain)
  registerGnomadDomain(ipcMain)
  registerHpoDomain(ipcMain)
  registerImportDomain(ipcMain)
  registerJobsHandlers()
  registerMyvariantDomain(ipcMain)
  registerPanelsDomain(ipcMain)
  registerProteinDomain(ipcMain)
  registerReferenceServicesDomain(ipcMain)
  registerRegionFilesDomain(ipcMain)
  registerSpliceaiDomain(ipcMain)
  registerTagsDomain(ipcMain)
  registerTranscriptsDomain(ipcMain)
  registerVariantsDomain(ipcMain)
  registerVepDomain(ipcMain)

  // Legacy flat-registration handlers (not yet in a domain module)
  registerShellHandlers(deps)
  registerShortlistHandlers(deps)
  registerSystemHandlers(deps)
  registerUpdaterHandlers(deps)

  mainLogger.info('IPC handlers registered', 'ipc')
}
