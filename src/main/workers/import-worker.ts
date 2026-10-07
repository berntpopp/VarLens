import { parentPort } from 'worker_threads'
import type { Database as DatabaseType } from 'better-sqlite3-multiple-ciphers'
import { statSync } from 'node:fs'
import { basename } from 'node:path'

import type { WorkerMessage, MainMessage } from '../../shared/types/import-worker'
import { DATABASE_CONFIG } from '../../shared/config'
import { detectFormat } from '../import/format-detection'
import { resolveBatchSize } from '../import/bounded-batcher'
import { openImportSummarySession } from '../database/cohort-summary-case-add'
import {
  checkpointBetweenFiles,
  openWorkerDatabase,
  rebuildFts,
  rebuildCohortSummary
} from './worker-db'
import {
  finalizeInterruptedImportFts,
  postTerminalMessageAfterCleanup,
  type ImportFtsFinalizationState
} from './import-finalization'
import {
  DROP_FTS_TRIGGERS,
  DROP_INDEXES,
  RECREATE_INDEXES,
  prepareStatements,
  streamInsertJson,
  streamInsertVcf
} from './import-pipeline'
import { ImportSkipTracker } from './import-skip-tracker'
import { classifyWorkerError } from '../storage/import-worker-errors'
import { VariantFrequencyService } from '../database/VariantFrequencyService'

export interface ImportWorkerPort {
  postMessage: (message: WorkerMessage) => void
}

let cancelled = false

export async function runImportSession(
  msg: Extract<MainMessage, { type: 'start' }>,
  port: ImportWorkerPort,
  isCancelled: () => boolean = () => cancelled
): Promise<void> {
  let db: DatabaseType | null = null
  let terminalMessage: WorkerMessage | undefined
  const ftsFinalizationState: ImportFtsFinalizationState = {
    ftsTriggersDropped: false,
    ftsRebuilt: false
  }

  try {
    // Reject a bad batch size before the database is opened or touched.
    const batchSize = resolveBatchSize(msg.batchSize, DATABASE_CONFIG.BATCH_INSERT_SIZE)
    db = openWorkerDatabase(msg.dbPath, msg.encryptionKey)

    const stmts = prepareStatements(db)
    // Internal allele-frequency upkeep runs here, on the worker connection
    // that already holds the write lock, instead of on the Electron main
    // thread after the worker finishes (audit 05 finding M-1).
    const frequencies = new VariantFrequencyService(db)

    // Drop FTS triggers and non-essential indexes at start (batch optimization)
    db.exec(DROP_FTS_TRIGGERS)
    ftsFinalizationState.ftsTriggersDropped = true
    db.exec(DROP_INDEXES)

    // Recovery: a previous worker died mid-file (heap limit) and could not
    // run its own cleanup. Its frequencies were never counted, so the rows
    // are simply removed; the session end rebuilds FTS and indexes.
    for (const partialCaseId of msg.discardCaseIds ?? []) {
      stmts.deleteCase.run(partialCaseId)
    }

    // The cohort summary stays exact after every file instead of going stale
    // for the session (cohort-summary-case-add.ts). A crashed worker may have
    // committed a file's contribution before dying, so a recovery session
    // rebuilds once first.
    const workerDb = db
    const summary = openImportSummarySession(workerDb, {
      forceRebuild: (msg.discardCaseIds ?? []).length > 0,
      rebuild: () => rebuildCohortSummary(workerDb),
      onWarning: (warning) => console.warn(`[import-worker] ${warning}`)
    })

    const totalFiles = msg.files.length
    const importedInBatch = new Set<string>()
    const results: Array<{
      filePath: string
      fileName: string
      caseName: string
      status: 'success' | 'failed' | 'skipped'
      variantCount?: number
      error?: string
      errorCode?: string
      userMessage?: string
    }> = []
    let succeeded = 0
    let failed = 0
    let skipped = 0
    let lastProgressTime = 0

    for (let fileIndex = 0; fileIndex < totalFiles; fileIndex++) {
      if (isCancelled()) {
        for (let j = fileIndex; j < totalFiles; j++) {
          const f = msg.files[j]
          results.push({
            filePath: f.filePath,
            fileName: basename(f.filePath),
            caseName: f.caseName,
            status: 'skipped',
            error: 'Cancelled by user'
          })
          skipped++
        }
        break
      }

      const file = msg.files[fileIndex]
      const fileName = basename(file.filePath)

      try {
        // Validate file existence and accessibility before touching database or deleting existing case (F02)
        const fileStat = statSync(file.filePath)
        if (!fileStat.isFile()) {
          throw new Error(`File is not a regular file: ${file.filePath}`)
        }
        const fileSize = fileStat.size

        // Handle duplicates (database + in-batch)
        const existing = stmts.getCaseByName.get(file.caseName) as { id: number } | undefined
        const isInBatchDuplicate = importedInBatch.has(file.caseName)

        if (existing || file.isDuplicate || isInBatchDuplicate) {
          if (file.duplicateStrategy === 'skip') {
            results.push({
              filePath: file.filePath,
              fileName,
              caseName: file.caseName,
              status: 'skipped',
              error: 'Duplicate case name'
            })
            skipped++
            continue
          } else if (existing) {
            // Replacing a case: drop its contribution to the shared
            // frequency table before its variants disappear.
            frequencies.decrementFrequencies(existing.id)
            summary.replaceCase(existing.id, () => stmts.deleteCase.run(existing.id))
          }
        }

        // Create case record
        // Use VCF genome build override if provided, otherwise default to GRCh38
        const genomeBuild = file.vcfGenomeBuild ?? 'GRCh38'
        const caseResult = stmts.insertCase.run(
          file.caseName,
          file.filePath,
          fileSize,
          Date.now(),
          genomeBuild
        )
        const caseId = Number(caseResult.lastInsertRowid)
        port.postMessage({ type: 'case-started', fileIndex, caseId })

        const startTime = Date.now()
        let variantCount = 0
        const skipTracker = new ImportSkipTracker()

        try {
          // Emit parsing phase progress
          sendProgress(
            port,
            fileIndex,
            totalFiles,
            fileName,
            Math.round((fileIndex / totalFiles) * 100),
            'parsing',
            0,
            0
          )

          const formatInfo = await detectFormat(file.filePath)

          const onProgress = (count: number): void => {
            const now = Date.now()
            if (now - lastProgressTime >= msg.throttleMs) {
              lastProgressTime = now
              const progressMsg: WorkerMessage = {
                type: 'progress',
                fileIndex,
                totalFiles,
                fileName,
                overallPercent: Math.round(((fileIndex + 0.5) / totalFiles) * 100),
                phase: 'inserting',
                variantCount: count,
                skipped: skipTracker.count
              }
              port.postMessage(progressMsg)
            }
          }

          stmts.beginBulkInsert()
          try {
            if (formatInfo.format === 'vcf') {
              variantCount = await streamInsertVcf(
                file.filePath,
                formatInfo,
                caseId,
                batchSize,
                stmts,
                isCancelled,
                file.vcfSelectedSamples,
                onProgress,
                (reason) => {
                  if (skipTracker.record(reason)) {
                    console.warn(`[import-worker] VCF line skipped in ${fileName}:`, reason)
                  }
                }
              )
            } else {
              variantCount = await streamInsertJson(
                file.filePath,
                formatInfo,
                caseId,
                batchSize,
                stmts,
                isCancelled,
                onProgress
              )
            }
          } finally {
            stmts.finishBulkInsert(caseId, variantCount)
          }

          if (isCancelled()) {
            // Cancelled mid-file: the case holds only part of its file. Remove
            // it rather than reporting a truncated case as a successful import.
            stmts.deleteCase.run(caseId)
            results.push({
              filePath: file.filePath,
              fileName,
              caseName: file.caseName,
              status: 'skipped',
              error: 'Cancelled by user'
            })
            skipped++
            continue
          }

          // Insert data_info provenance
          try {
            stmts.insertDataInfo.run(caseId, fileName, formatInfo.format)
          } catch (e) {
            console.warn(
              '[import-worker] Failed to insert data_info provenance:',
              e instanceof Error ? e.message : String(e)
            )
          }

          try {
            frequencies.updateFrequencies(caseId)
          } catch (e) {
            console.warn(
              '[import-worker] Failed to update variant frequencies:',
              e instanceof Error ? e.message : String(e)
            )
          }

          // The file's rows are committed and it was not cancelled: merge it
          // into the cohort summary before anyone is told the file is done.
          summary.addCase(caseId)
          checkpointBetweenFiles(db)

          const elapsed = Date.now() - startTime

          results.push({
            filePath: file.filePath,
            fileName,
            caseName: file.caseName,
            status: 'success',
            variantCount
          })
          succeeded++
          importedInBatch.add(file.caseName)

          const fileCompleteMsg: WorkerMessage = {
            type: 'file-complete',
            fileIndex,
            result: {
              caseId,
              caseName: file.caseName,
              variantCount,
              skipped: skipTracker.count,
              skipReasons: skipTracker.reasons,
              elapsed
            }
          }
          port.postMessage(fileCompleteMsg)
        } catch (importError) {
          stmts.deleteCase.run(caseId)
          throw importError
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error)
        const errorStack = error instanceof Error ? error.stack : undefined

        const { code: errorCode, userMessage } = classifyWorkerError(error)
        results.push({
          filePath: file.filePath,
          fileName,
          caseName: file.caseName,
          status: 'failed',
          error: errorMsg,
          ...(errorCode !== undefined ? { errorCode, userMessage } : {})
        })
        failed++

        const workerErrorMsg: WorkerMessage = {
          type: 'error',
          fileIndex,
          error: errorMsg,
          phase: 'import',
          stack: errorStack
        }
        port.postMessage(workerErrorMsg)
      }
    }

    // Indexes first: rebuildFts runs the global ANALYZE, and sqlite_stat1 only
    // gets rows for indexes that exist at that moment.
    sendProgress(port, totalFiles, totalFiles, '', 99, 'finalizing', 0, 0)
    recreateSessionIndexes(db)
    rebuildFts(db)
    ftsFinalizationState.ftsRebuilt = true
    summary.finish()

    const completeMsg: WorkerMessage = {
      type: 'complete',
      results: { succeeded, failed, skipped, cancelled: isCancelled(), details: results }
    }
    terminalMessage = completeMsg
  } catch (fatalError) {
    // Index/trigger recreation is repeated unconditionally in the finally block below

    const { code: errorCode, userMessage } = classifyWorkerError(fatalError)
    terminalMessage = {
      type: 'error',
      fileIndex: -1,
      error: fatalError instanceof Error ? fatalError.message : String(fatalError),
      phase: 'fatal',
      stack: fatalError instanceof Error ? fatalError.stack : undefined,
      ...(errorCode !== undefined ? { errorCode, userMessage } : {})
    }
  } finally {
    postTerminalMessageAfterCleanup(
      terminalMessage,
      () => {
        if (db) {
          // Safety net for error/cancel paths: a no-op after an orderly end.
          // Before the FTS finalizer, whose ANALYZE must see the indexes.
          recreateSessionIndexes(db)
          finalizeInterruptedImportFts(db, ftsFinalizationState)
          try {
            db.pragma('wal_checkpoint(TRUNCATE)')
          } catch (e) {
            console.warn(
              '[import-worker] Failed to truncate WAL checkpoint:',
              e instanceof Error ? e.message : String(e)
            )
          }
          try {
            db.pragma('synchronous = NORMAL')
            db.pragma('wal_autocheckpoint = 1000')
            db.pragma('foreign_keys = ON')
          } catch (e) {
            console.warn(
              '[import-worker] Failed to restore pragmas after import:',
              e instanceof Error ? e.message : String(e)
            )
          }
          try {
            db.close()
          } catch (e) {
            console.warn(
              '[import-worker] Failed to close database:',
              e instanceof Error ? e.message : String(e)
            )
          }
        }
      },
      (message) => port.postMessage(message)
    )
  }
}

if (parentPort) {
  const port = parentPort
  port.on('message', async (msg: MainMessage) => {
    if (msg.type === 'cancel') {
      cancelled = true
      return
    }

    if (msg.type === 'start') {
      cancelled = false
      await runImportSession(msg, port, () => cancelled)
    }
  })
}

/** Recreate the indexes dropped for the bulk insert (idempotent, best-effort). */
function recreateSessionIndexes(db: DatabaseType): void {
  try {
    db.exec(RECREATE_INDEXES)
  } catch (e) {
    console.warn(
      '[import-worker] Failed to recreate indexes (will be recreated on next app start):',
      e instanceof Error ? e.message : String(e)
    )
  }
}

function sendProgress(
  port: ImportWorkerPort,
  fileIndex: number,
  totalFiles: number,
  fileName: string,
  overallPercent: number,
  phase: string,
  variantCount: number,
  skipped: number
): void {
  const msg: WorkerMessage = {
    type: 'progress',
    fileIndex,
    totalFiles,
    fileName,
    overallPercent,
    phase,
    variantCount,
    skipped
  }
  port.postMessage(msg)
}
