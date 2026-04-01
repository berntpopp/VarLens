import { parentPort } from 'worker_threads'
import type { Database as DatabaseType } from 'better-sqlite3-multiple-ciphers'
import { statSync } from 'node:fs'
import { basename } from 'node:path'

import type { WorkerMessage, MainMessage } from '../../shared/types/import-worker'
import { DATABASE_CONFIG } from '../../shared/config'
import { detectFormat } from '../import/format-detection'
import { MARK_STALE_SQL } from '../../shared/sql/cohort-summary-rebuild'
import { openWorkerDatabase, rebuildFts, rebuildCohortSummary } from './worker-db'
import {
  DROP_FTS_TRIGGERS,
  DROP_INDEXES,
  RECREATE_INDEXES,
  prepareStatements,
  streamInsertJson,
  streamInsertVcf
} from './import-pipeline'

if (!parentPort) throw new Error('Must be run as worker thread')

const port = parentPort

let cancelled = false

port.on('message', async (msg: MainMessage) => {
  if (msg.type === 'cancel') {
    cancelled = true
    return
  }

  if (msg.type === 'start') {
    cancelled = false
    let db: DatabaseType | null = null

    try {
      db = openWorkerDatabase(msg.dbPath, msg.encryptionKey)

      const stmts = prepareStatements(db)

      // Drop FTS triggers and non-essential indexes at start (batch optimization)
      db.exec(DROP_FTS_TRIGGERS)
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
      const batchSize = msg.batchSize ?? DATABASE_CONFIG.BATCH_INSERT_SIZE
      const importedInBatch = new Set<string>()
      const results: Array<{
        filePath: string
        fileName: string
        caseName: string
        status: 'success' | 'failed' | 'skipped'
        variantCount?: number
        error?: string
      }> = []
      let succeeded = 0
      let failed = 0
      let skipped = 0
      let lastProgressTime = 0

      for (let fileIndex = 0; fileIndex < totalFiles; fileIndex++) {
        if (cancelled) {
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
              stmts.deleteCase.run(existing.id)
            }
          }

          // Create case record
          const fileSize = statSync(file.filePath).size
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
          const fileSkipped = 0

          try {
            // Emit parsing phase progress
            sendProgress(
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
                  skipped: fileSkipped
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
                  onProgress
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
                skipped: fileSkipped,
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

          results.push({
            filePath: file.filePath,
            fileName,
            caseName: file.caseName,
            status: 'failed',
            error: errorMsg
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
      sendProgress(totalFiles, totalFiles, '', 99, 'finalizing', 0, 0)
      rebuildFts(db)
      rebuildCohortSummary(db)

      const completeMsg: WorkerMessage = {
        type: 'complete',
        results: { succeeded, failed, skipped, cancelled, details: results }
      }
      port.postMessage(completeMsg)
    } catch (fatalError) {
      // Index/trigger recreation is handled unconditionally in the finally block below

      const errorMsg: WorkerMessage = {
        type: 'error',
        fileIndex: -1,
        error: fatalError instanceof Error ? fatalError.message : String(fatalError),
        phase: 'fatal',
        stack: fatalError instanceof Error ? fatalError.stack : undefined
      }
      port.postMessage(errorMsg)
    } finally {
      if (db) {
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
    }
  }
})

function sendProgress(
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
