import { parentPort } from 'worker_threads'
import type { Database as DatabaseType } from 'better-sqlite3-multiple-ciphers'
import { statSync } from 'node:fs'
import { basename } from 'node:path'

import type { WorkerMessage, MainMessage } from '../../shared/types/import-worker'
import { DATABASE_CONFIG } from '../../shared/config'
import { detectFormat } from '../import/format-detection'
import { resolveBatchSize } from '../import/bounded-batcher'
import { MARK_STALE_SQL } from '../../shared/sql/cohort-summary-rebuild'
import { openWorkerDatabase, rebuildFts, rebuildCohortSummary } from './worker-db'
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

    // Mark cohort summary as stale before import
    try {
      db.exec(MARK_STALE_SQL)
    } catch (e) {
      console.warn(
        '[import-worker] Failed to mark cohort summary as stale (table may not exist yet):',
        e instanceof Error ? e.message : String(e)
      )
    }

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
            stmts.deleteCase.run(existing.id)
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
                () => cancelled,
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
                () => cancelled,
                onProgress
              )
            }
          } finally {
            stmts.finishBulkInsert(caseId, variantCount)
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

    // FTS rebuild + ANALYZE + optimize
    sendProgress(port, totalFiles, totalFiles, '', 99, 'finalizing', 0, 0)
    rebuildFts(db)
    ftsFinalizationState.ftsRebuilt = true
    rebuildCohortSummary(db)

    const completeMsg: WorkerMessage = {
      type: 'complete',
      results: { succeeded, failed, skipped, cancelled: isCancelled(), details: results }
    }
    terminalMessage = completeMsg
  } catch (fatalError) {
    // Index/trigger recreation is handled unconditionally in the finally block below

    terminalMessage = {
      type: 'error',
      fileIndex: -1,
      error: fatalError instanceof Error ? fatalError.message : String(fatalError),
      phase: 'fatal',
      stack: fatalError instanceof Error ? fatalError.stack : undefined
    }
  } finally {
    postTerminalMessageAfterCleanup(
      terminalMessage,
      () => {
        if (db) {
          finalizeInterruptedImportFts(db, ftsFinalizationState)
          try {
            db.exec(RECREATE_INDEXES)
          } catch (e) {
            console.warn(
              '[import-worker] Failed to recreate indexes (will be recreated on next app start):',
              e instanceof Error ? e.message : String(e)
            )
          }
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
