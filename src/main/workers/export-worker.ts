import { parentPort } from 'worker_threads'
import type { Database as DatabaseType } from 'better-sqlite3-multiple-ciphers'
import type { ExportMainMessage, ExportWorkerMessage } from '../../shared/types/export-worker'
import { openWorkerDatabaseReadOnly } from './worker-db'
import { runExportPipeline } from './export-pipeline'

function postMsg(msg: ExportWorkerMessage): void {
  parentPort?.postMessage(msg)
}

async function run(msg: ExportMainMessage & { type: 'start' }): Promise<void> {
  let db: DatabaseType | null = null

  try {
    db = openWorkerDatabaseReadOnly(msg.dbPath, msg.encryptionKey)

    const result = await runExportPipeline({
      db,
      compiledSql: msg.compiledSql,
      compiledParams: msg.compiledParams,
      outputFilePath: msg.outputFilePath,
      format: msg.format,
      caseName: msg.caseName,
      filterSummary: msg.filterSummary,
      onProgress: (current, total) => {
        postMsg({ type: 'progress', current, total })
      }
    })

    postMsg({
      type: 'complete',
      filePath: result.filePath,
      rowCount: result.rowCount
    })
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    postMsg({ type: 'error', error: err.message, stack: err.stack })
  } finally {
    db?.close()
  }
}

// Listen for messages from main thread
parentPort?.on('message', (msg: ExportMainMessage) => {
  if (msg.type === 'start') {
    run(msg)
  }
  // Note: cancel is not supported — the entire query+XLSX/CSV generation
  // runs synchronously in the worker. The main thread can terminate
  // the worker if cancellation is needed.
})
