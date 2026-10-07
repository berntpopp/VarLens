/**
 * Interrupted imports at app start (SQLite).
 *
 * An import that was cut off — app killed, power loss — leaves its case
 * 'provisional': hidden from every reader, rows on disk, name taken. The
 * import worker discards such cases at the start of every session
 * (workers/import-recovery.ts, same semantics as PostgreSQL's
 * `recoverInterruptedImports`). Opening a database must not wait for the
 * user's next import to do that, so it runs one file-less session right away:
 * the same recovery run the worker client uses after a worker crash. That
 * session also rebuilds FTS, recreates the indexes the dead session dropped
 * and rebuilds the cohort summary the dead session left open.
 */
import { API_CONFIG } from '../../../shared/config'
import { formatErrorMessage } from '../../../shared/errors/format-error-message'
import { mainLogger } from '../../services/MainLogger'
import { trackDatabaseWorker } from '../../services/jobs/database-activity'
import { workerErrorToError } from '../../storage/import-worker-errors'
import { ImportWorkerClient } from '../../workers/import-worker-client'
import { triggerStartupRebuildIfNeeded, type CohortCallbacks } from './cohort-logic'
import { withActiveImportOperation } from './import-logic'
import type { DatabaseService } from '../../database/DatabaseService'

export interface InterruptedImportRecoveryDeps {
  createWorkerClient?: () => Pick<ImportWorkerClient, 'start'>
}

/**
 * Discard what interrupted imports left in `db`. Holds the process's import
 * slot while it runs: the recovery deletes every provisional case, which must
 * never include one a running import is filling. Rejects if the session fails;
 * the leftovers then wait for the next import session or app start.
 */
export function recoverInterruptedImports(
  db: DatabaseService,
  deps: InterruptedImportRecoveryDeps = {}
): Promise<void> {
  const session = withActiveImportOperation(
    () => undefined, // nothing to cancel: the session imports no file
    () =>
      new Promise<void>((resolve, reject) => {
        const client = deps.createWorkerClient?.() ?? new ImportWorkerClient()
        client.start({
          files: [],
          dbPath: db.getPath(),
          encryptionKey: db.getEncryptionKey(),
          throttleMs: API_CONFIG.PROGRESS_THROTTLE_MS,
          onProgress: () => undefined,
          onFileComplete: () => undefined,
          onComplete: () => resolve(),
          onError: (msg) => {
            if (msg.fileIndex !== -1) return
            reject(
              workerErrorToError({
                message: msg.error,
                code: msg.errorCode,
                userMessage: msg.userMessage
              })
            )
          }
        })
      })
  )
  // A re-key must not start while the recovery worker is writing.
  return trackDatabaseWorker('interrupted import recovery', session)
}

export interface StartupRecoveryDeps {
  recover?: (db: DatabaseService) => Promise<void>
  triggerRebuild?: (db: DatabaseService, callbacks: CohortCallbacks) => void
}

/**
 * Startup housekeeping for a database that was just opened: discard
 * interrupted imports, then let the startup summary rebuild check run. The
 * recovery session rebuilds the summary itself when the dead session left it
 * open, so the rebuild worker usually finds nothing left to do. Never
 * rejects; resolves when the recovery (if any) is over.
 */
export async function recoverInterruptedImportsAtStartup(
  db: DatabaseService,
  callbacks: CohortCallbacks,
  deps: StartupRecoveryDeps = {}
): Promise<void> {
  const triggerRebuild = deps.triggerRebuild ?? triggerStartupRebuildIfNeeded
  if (!db.hasInterruptedImports()) {
    triggerRebuild(db, callbacks)
    return
  }

  mainLogger.info('Startup: discarding interrupted imports', 'import')
  const wasStale = db.needsStartupRebuild()
  if (wasStale) callbacks.onSummaryStale?.({ is_stale: true })
  try {
    await (deps.recover ?? recoverInterruptedImports)(db)
  } catch (e) {
    mainLogger.error(
      `Startup: could not discard interrupted imports: ${formatErrorMessage(e, 'unknown error')}`,
      'import'
    )
  }

  if (db.needsStartupRebuild()) {
    triggerRebuild(db, callbacks)
  } else if (wasStale) {
    try {
      db.cohort.invalidateColumnMetaCache()
    } catch {
      // The database was closed meanwhile; its cache went with it.
    }
    callbacks.onSummaryFresh?.({ is_stale: false })
  }
}
