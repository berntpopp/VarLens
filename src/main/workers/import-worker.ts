import {
  resetUnrankedClinvar,
  takeUnrankedClinvar,
  unrankedClinvarLogLine
} from '../import/unranked-clinvar'
import { resetAfOutOfRange, takeAfOutOfRange } from '../import/af-out-of-range'
import { resetAmbiguousCsqSites, takeAmbiguousCsqSites } from '../import/vcf/vcf-csq-allele'
import { parentPort } from 'worker_threads'
import type { Database as DatabaseType } from 'better-sqlite3-multiple-ciphers'
import { statSync } from 'node:fs'
import { basename } from 'node:path'

import type { WorkerMessage, MainMessage } from '../../shared/types/import-worker'
import { DATABASE_CONFIG, IMPORT_MESSAGES } from '../../shared/config'
import { replacementCaseName } from '../../shared/utils/case-name'
import { detectFormat } from '../import/format-detection'
import { loadImportFilters } from '../import/vcf/import-filters'
import { parseVcfHeader } from '../import/vcf/vcf-header-parser'
import { resolveImportGenomeBuild } from '../import/vcf/resolve-genome-build'
import { resolveVcfSelectedSampleColumn } from '../import/vcf/vcf-line-parser'
import { resolveBatchSize } from '../import/bounded-batcher'
import {
  openImportSummarySession,
  type ImportSummarySession
} from '../database/cohort-summary-case-add'
import {
  checkpointBetweenFiles,
  openWorkerDatabase,
  restoreFts,
  rebuildCohortSummary
} from './worker-db'
import {
  finalizeInterruptedImportFts,
  postTerminalMessageAfterCleanup,
  type ImportFtsFinalizationState
} from './import-finalization'
import {
  DROP_INDEXES,
  RECREATE_INDEXES,
  keepsIndexesForSession,
  prepareStatements
} from './import-pipeline'
import { appendFileToCase, streamFileIntoCase } from './import-append'
import { FieldProfileResolver } from '../../shared/utils/import-field-profile'
import { ftsTriggersComplete, tearDownFtsTriggers } from '../database/fts-trigger-management'
import { discardInterruptedImports } from './import-recovery'
import { ImportSkipTracker } from './import-skip-tracker'
import { classifyWorkerError } from '../storage/import-worker-errors'

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

    // Opened below, once the leftovers of a dead worker are gone.
    const summaryRef: { session?: ImportSummarySession } = {}
    const stmts = prepareStatements(db, () => summaryRef.session?.keepSessionOpen())

    // Recovery, before anything is counted or dropped: what interrupted
    // imports left behind goes (import-recovery.ts) — the case a dead worker
    // was filling, named by the main process, and every case that was never
    // published. The FTS triggers, still up, take its rows out of the index.
    const ftsTriggersLive = ftsTriggersComplete(db)
    discardInterruptedImports(
      db,
      msg.discardCaseIds ?? [],
      (caseId) => void stmts.deleteCase.run(caseId)
    )

    // FTS row triggers are down for every session: per-row FTS upkeep costs
    // about 25x a bulk index (#551: 300k SVs into 1.2M rows, 349 s against
    // 14 s). A bulk load relative to what is stored (import-index-sql.ts)
    // also drops the non-essential indexes and rebuilds both at the end. A
    // small session keeps the indexes and indexes only its own rows, above
    // the watermark, instead of rebuilding the whole index (#559). Missing
    // triggers (a session that died) force the rebuild.
    const storedCases = (db.prepare('SELECT COUNT(*) AS c FROM cases').get() as { c: number }).c
    const keepIndexes = keepsIndexesForSession(storedCases, msg.files.length)
    let ftsWatermark = keepIndexes && ftsTriggersLive ? maxVariantId(db) : null
    tearDownFtsTriggers(db)
    ftsFinalizationState.ftsTriggersDropped = true
    if (!keepIndexes) db.exec(DROP_INDEXES)

    // The cohort summary stays exact after every file instead of going stale
    // for the session (cohort-summary-case-add.ts). A crashed worker may have
    // published its file before dying, so a recovery session rebuilds once
    // first.
    const workerDb = db
    const summary = openImportSummarySession(workerDb, {
      forceRebuild: (msg.discardCaseIds ?? []).length > 0,
      rebuild: () => rebuildCohortSummary(workerDb),
      onWarning: (warning) => console.warn(`[import-worker] ${warning}`),
      onStale: () => {
        // Best effort: the flag in the database is what counts.
        try {
          port.postMessage({ type: 'summary-stale' })
        } catch (e) {
          console.warn(
            '[import-worker] Failed to report the stale cohort summary:',
            e instanceof Error ? e.message : String(e)
          )
        }
      }
    })
    summaryRef.session = summary

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
      unrankedClinvar?: string[]
      /** Variants whose gnomAD AF lies outside [0, 1] (stored as imported). */
      afOutOfRange?: number
      csqAmbiguousSites?: number
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
      resetUnrankedClinvar()
      resetAfOutOfRange()
      resetAmbiguousCsqSites()
      const fileName = basename(file.filePath)
      const startTime = Date.now()
      const skipTracker = new ImportSkipTracker()
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
      const onSkip = (reason: string): void => {
        if (skipTracker.record(reason)) {
          console.warn(`[import-worker] Record skipped in ${fileName}:`, reason)
        }
      }
      const skipCancelled = (): void => {
        results.push({
          filePath: file.filePath,
          fileName,
          caseName: file.caseName,
          status: 'skipped',
          error: 'Cancelled by user'
        })
        skipped++
      }
      /** Tell the main process the file is in: only then does it count as imported. */
      const reportImported = (caseId: number, variantCount: number): void => {
        checkpointBetweenFiles(workerDb)
        // Worker thread: no structured logger (documented console exception).
        const unrankedClinvar = takeUnrankedClinvar()
        if (unrankedClinvar !== undefined) {
          console.warn(`[import-worker] ${unrankedClinvarLogLine(file.caseName, unrankedClinvar)}`)
        }
        const afOutOfRange = takeAfOutOfRange()
        if (afOutOfRange !== undefined) {
          console.warn(
            `[import-worker] ${file.caseName}: ${IMPORT_MESSAGES.afOutOfRange(afOutOfRange)}`
          )
        }
        const csqAmbiguousSites = takeAmbiguousCsqSites()
        if (csqAmbiguousSites !== undefined) {
          console.warn(
            `[import-worker] ${file.caseName}: ${IMPORT_MESSAGES.csqAmbiguousSites(csqAmbiguousSites)}`
          )
        }
        const extra = {
          ...(unrankedClinvar !== undefined ? { unrankedClinvar } : {}),
          ...(afOutOfRange !== undefined ? { afOutOfRange } : {}),
          ...(csqAmbiguousSites !== undefined ? { csqAmbiguousSites } : {})
        }
        port.postMessage({
          type: 'file-complete',
          fileIndex,
          result: {
            caseId,
            caseName: file.caseName,
            variantCount,
            skipped: skipTracker.count,
            skipReasons: skipTracker.reasons,
            ...extra,
            elapsed: Date.now() - startTime
          }
        })
        results.push({
          filePath: file.filePath,
          fileName,
          caseName: file.caseName,
          status: 'success',
          variantCount,
          ...extra
        })
        succeeded++
      }

      try {
        if (file.appendToCaseId !== undefined) {
          // Multi-file case: rows go into the published case (import-append.ts).
          // Named as a replacement: after a crash the client runs a recovery
          // session (FTS, indexes) that must not delete the published case.
          port.postMessage({
            type: 'case-started',
            fileIndex,
            caseId: file.appendToCaseId,
            replacement: true
          })
          const added = await appendFileToCase({
            db: workerDb,
            summary,
            file,
            caseId: file.appendToCaseId,
            batchSize,
            stmts,
            isCancelled,
            onProgress,
            onSkip
          })
          if (added === null) skipCancelled()
          else reportImported(file.appendToCaseId, added)
          continue
        }
        // Validate file existence and accessibility before touching database or deleting existing case (F02)
        const fileStat = statSync(file.filePath)
        if (!fileStat.isFile()) {
          throw new Error(`File is not a regular file: ${file.filePath}`)
        }
        const fileSize = fileStat.size
        // Before any case is created or replaced: an unreadable BED file fails the file.
        const vcfFilters = await loadImportFilters(file.vcfFilters)

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
            // Fail fast on what the head of the file shows. The old case stays
            // until its replacement is published (#493).
            if ((await detectFormat(file.filePath)).format === 'vcf') {
              const { header } = await parseVcfHeader(file.filePath)
              resolveVcfSelectedSampleColumn(header.samples, file.vcfSelectedSamples?.[0])
            }
          }
        }

        const formatInfo = await detectFormat(file.filePath)
        // Before any case is created: a file without a usable build fails here.
        const genomeBuild = await resolveImportGenomeBuild({
          filePath: file.filePath,
          isVcf: formatInfo.format === 'vcf',
          explicit: file.vcfGenomeBuild,
          fallback: file.fallbackGenomeBuild
        })
        // Create case record
        const caseResult = stmts.insertCase.run(
          // cases.name is UNIQUE: a replacement is filled under a temporary name.
          existing ? replacementCaseName(file.caseName, existing.id) : file.caseName,
          file.filePath,
          fileSize,
          Date.now(),
          genomeBuild
        )
        const caseId = Number(caseResult.lastInsertRowid)
        port.postMessage({
          type: 'case-started',
          fileIndex,
          caseId,
          ...(existing ? { replacement: true } : {})
        })

        let variantCount = 0
        // What the case has contributed outside its own rows so far: nothing
        // until it is published, then its part of the cohort summary.
        let published = false

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

          const fields = new FieldProfileResolver(file.fieldProfile)
          try {
            variantCount = await streamFileIntoCase({
              file,
              formatInfo,
              caseId,
              batchSize,
              stmts,
              isCancelled,
              onProgress,
              onSkip,
              vcfFilters,
              fields
            })
          } finally {
            stmts.finishBulkInsert(caseId, variantCount)
          }

          if (isCancelled()) {
            // Cancelled mid-file: the case holds only part of its file. Remove
            // it rather than reporting a truncated case as a successful import.
            summary.discardCase(() => stmts.deleteCase.run(caseId))
            skipCancelled()
            continue
          }

          // Insert data_info provenance
          try {
            stmts.insertDataInfo.run(caseId, fileName, formatInfo.format, fields.dictionary())
          } catch (e) {
            console.warn(
              '[import-worker] Failed to insert data_info provenance:',
              e instanceof Error ? e.message : String(e)
            )
          }

          // The file's rows are committed and it was not cancelled: publish
          // the case before anyone is told the file is done.
          publishCase(db, () => {
            if (existing) {
              // In the publishing transaction: the old case goes, with its
              // summary contribution, only if the new one arrives.
              // Indexed rows go without their triggers: rebuild at the end.
              ftsWatermark = null
              summary.replaceCase(existing.id, () => stmts.deleteCase.run(existing.id))
              workerDb.prepare('UPDATE cases SET name = ? WHERE id = ?').run(file.caseName, caseId)
            }
            summary.addCase(caseId, totalFiles - fileIndex - 1)
          })
          published = true
          reportImported(caseId, variantCount)
          importedInBatch.add(file.caseName)
        } catch (importError) {
          // The published replacement of an overwritten case stays, though its
          // file is reported failed: the case it replaced is already gone (#493).
          if (published && existing) throw importError
          // The case goes, and with it everything it already contributed.
          const deleteCase = (): void => void stmts.deleteCase.run(caseId)
          if (published) summary.replaceCase(caseId, deleteCase)
          else summary.discardCase(deleteCase)
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
    restoreFts(db, ftsWatermark)
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

/**
 * Publish an imported case in ONE transaction: its cohort-summary state
 * (merged, or flagged stale) and the flip from 'provisional' to 'ready'.
 * Crash recovery deletes a provisional case without touching the summary, so
 * a provisional case must have contributed nothing. A throw rolls it all back.
 */
function publishCase(db: DatabaseType, publishInSummary: () => void): void {
  db.transaction(publishInSummary).immediate()
}

function maxVariantId(db: DatabaseType): number {
  return (db.prepare('SELECT COALESCE(MAX(id), 0) AS id FROM variants').get() as { id: number }).id
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
