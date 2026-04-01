import { Worker } from 'worker_threads'
import { resolve } from 'path'
import type {
  ExportMainMessage,
  ExportWorkerMessage,
  ExportFilterSummary
} from '../../shared/types/export-worker'
import { mainLogger } from '../services/MainLogger'

export interface ExportWorkerCallbacks {
  dbPath: string
  encryptionKey?: string
  compiledSql: string
  compiledParams: readonly unknown[]
  outputFilePath: string
  caseName: string
  filterSummary: ExportFilterSummary
  onProgress: (current: number, total: number) => void
  onComplete: (filePath: string, rowCount: number) => void
  onError: (error: string) => void
}

export class ExportWorkerClient {
  private worker: Worker | null = null
  private readonly workerPath: string

  constructor() {
    this.workerPath = resolve(__dirname, 'export-worker.js')
  }

  get isRunning(): boolean {
    return this.worker !== null
  }

  start(callbacks: ExportWorkerCallbacks): void {
    if (this.worker !== null) {
      throw new Error('Export worker is already running')
    }

    this.worker = new Worker(this.workerPath)

    this.worker.on('message', (msg: ExportWorkerMessage) => {
      switch (msg.type) {
        case 'progress':
          callbacks.onProgress(msg.current, msg.total)
          break
        case 'complete':
          callbacks.onComplete(msg.filePath, msg.rowCount)
          this.cleanup()
          break
        case 'error':
          callbacks.onError(msg.error)
          this.cleanup()
          break
      }
    })

    this.worker.on('error', (err: Error) => {
      mainLogger.error(`Export worker error: ${err.message}`, 'ExportWorkerClient')
      callbacks.onError(err.message)
      this.cleanup()
    })

    this.worker.on('exit', (code) => {
      if (code !== 0 && this.worker !== null) {
        mainLogger.error(`Export worker exited with code ${code}`, 'ExportWorkerClient')
      }
      this.worker = null
    })

    const startMsg: ExportMainMessage = {
      type: 'start',
      dbPath: callbacks.dbPath,
      encryptionKey: callbacks.encryptionKey,
      compiledSql: callbacks.compiledSql,
      compiledParams: callbacks.compiledParams,
      outputFilePath: callbacks.outputFilePath,
      caseName: callbacks.caseName,
      filterSummary: callbacks.filterSummary,
      format: callbacks.outputFilePath.toLowerCase().endsWith('.csv') ? 'csv' : 'xlsx'
    }

    this.worker.postMessage(startMsg)
  }

  /**
   * Cancel the export by terminating the worker.
   * The worker runs synchronously so message-based cancel isn't possible.
   */
  cancel(): void {
    this.cleanup()
  }

  private cleanup(): void {
    if (this.worker !== null) {
      this.worker.terminate().catch((err: Error) => {
        // Worker may already be terminated (e.g. after 'exit' event)
        mainLogger.warn(`Export worker terminate failed: ${err.message}`, 'ExportWorkerClient')
      })
      this.worker = null
    }
  }

  async destroy(): Promise<void> {
    if (this.worker !== null) {
      await this.worker.terminate()
      this.worker = null
    }
  }
}
