import { Worker } from 'worker_threads'
import { resolve } from 'path'
import { closeSync, fchmodSync, fstatSync, openSync, rmSync, statSync } from 'node:fs'
import type {
  ExportMainMessage,
  ExportWorkerMessage,
  ExportFilterSummary
} from '../../shared/types/export-worker'
import type { CohortSearchParams } from '../../shared/types/cohort'
import { mainLogger } from '../services/MainLogger'
import { defaultExportTempFilePath } from './export-pipeline'

/** Outcome hooks shared by every export kind. */
export interface ExportWorkerHooks {
  onProgress: (current: number, total: number) => void
  onComplete: (filePath: string, rowCount: number) => void
  onError: (error: string) => void
  /** Fired instead of onComplete/onError when {@link ExportWorkerClient.cancel} ran. */
  onCancelled?: () => void
}

export interface ExportWorkerCallbacks extends ExportWorkerHooks {
  dbPath: string
  encryptionKey?: string
  compiledSql: string
  compiledParams: readonly unknown[]
  outputFilePath: string
  tempFilePath?: string
  caseName: string
  filterSummary: ExportFilterSummary
}

export interface CohortExportWorkerParams extends ExportWorkerHooks {
  dbPath: string
  encryptionKey?: string
  params: CohortSearchParams
  outputFilePath: string
  tempFilePath?: string
}

export class ExportWorkerClient {
  private worker: Worker | null = null
  private hooks: ExportWorkerHooks | null = null
  private currentTempFilePath: string | null = null
  private readonly workerPath: string

  constructor(workerPath?: string) {
    this.workerPath = workerPath ?? resolve(__dirname, 'export-worker.js')
  }

  get isRunning(): boolean {
    return this.worker !== null
  }

  /** Variant export (pre-compiled SQL → CSV/XLSX). */
  start(callbacks: ExportWorkerCallbacks): void {
    this.launch(
      {
        type: 'start',
        dbPath: callbacks.dbPath,
        encryptionKey: callbacks.encryptionKey,
        compiledSql: callbacks.compiledSql,
        compiledParams: callbacks.compiledParams,
        outputFilePath: callbacks.outputFilePath,
        tempFilePath: callbacks.tempFilePath,
        caseName: callbacks.caseName,
        filterSummary: callbacks.filterSummary,
        format: callbacks.outputFilePath.toLowerCase().endsWith('.csv') ? 'csv' : 'xlsx'
      },
      callbacks
    )
  }

  /** Cohort export (cohort query + XLSX build, all inside the worker). */
  startCohort(options: CohortExportWorkerParams): void {
    this.launch(
      {
        type: 'start-cohort',
        dbPath: options.dbPath,
        encryptionKey: options.encryptionKey,
        params: options.params,
        outputFilePath: options.outputFilePath,
        tempFilePath: options.tempFilePath
      },
      options
    )
  }

  private launch(message: ExportMainMessage, hooks: ExportWorkerHooks): void {
    if (this.worker !== null) {
      throw new Error('Export worker is already running')
    }

    const isDevice = message.outputFilePath.startsWith('/dev/')
    let tempFilePath: string | undefined
    let tempFilePrecreated: { dev: number; ino: number } | undefined

    if (!isDevice) {
      tempFilePath = message.tempFilePath ?? defaultExportTempFilePath(message.outputFilePath)
      let targetMode = 0o600
      try {
        targetMode = statSync(message.outputFilePath).mode & 0o777
      } catch {
        // Destination does not exist yet; default to 0o600
      }
      try {
        const fd = openSync(tempFilePath, 'wx', targetMode)
        try {
          fchmodSync(fd, targetMode)
          const stat = fstatSync(fd)
          tempFilePrecreated = { dev: stat.dev, ino: stat.ino }
        } finally {
          closeSync(fd)
        }
        this.currentTempFilePath = tempFilePath
      } catch (err) {
        hooks.onError((err as Error).message)
        return
      }
    }

    this.hooks = hooks
    this.worker = new Worker(this.workerPath)

    this.worker.on('message', (msg: ExportWorkerMessage) => {
      switch (msg.type) {
        case 'progress':
          hooks.onProgress(msg.current, msg.total)
          break
        case 'complete':
          this.currentTempFilePath = null
          this.cleanup()
          hooks.onComplete(msg.filePath, msg.rowCount)
          break
        case 'error':
          this.cleanup()
          hooks.onError(msg.error)
          break
      }
    })

    this.worker.on('error', (err: Error) => {
      mainLogger.error(`Export worker error: ${err.message}`, 'ExportWorkerClient')
      if (this.worker === null) return
      this.cleanup()
      hooks.onError(err.message)
    })

    this.worker.on('exit', (code) => {
      if (code !== 0 && this.worker !== null) {
        mainLogger.error(`Export worker exited with code ${code}`, 'ExportWorkerClient')
        this.cleanup()
        hooks.onError(`Export worker exited with code ${code}`)
      }
    })

    this.worker.postMessage({
      ...message,
      ...(tempFilePath !== undefined ? { tempFilePath, tempFilePrecreated } : {})
    })
  }

  /**
   * Cancel the export by terminating the worker. The query and workbook
   * build run synchronously inside the worker, so termination (not a
   * message) is the cancellation mechanism.
   */
  cancel(): void {
    const hooks = this.hooks
    if (this.worker === null) return
    this.cleanup()
    hooks?.onCancelled?.()
  }

  private cleanup(): void {
    this.hooks = null
    const tempPath = this.currentTempFilePath
    this.currentTempFilePath = null
    const removeTempFile = (): void => {
      if (tempPath !== null) {
        try {
          rmSync(tempPath, { force: true })
        } catch {
          // ignore cleanup errors
        }
      }
    }
    if (this.worker !== null) {
      const worker = this.worker
      this.worker = null
      worker
        .terminate()
        .catch((err: Error) => {
          // Worker may already be terminated (e.g. after 'exit' event)
          mainLogger.warn(`Export worker terminate failed: ${err.message}`, 'ExportWorkerClient')
        })
        .finally(() => {
          removeTempFile()
        })
    } else {
      removeTempFile()
    }
  }

  async destroy(): Promise<void> {
    if (this.worker !== null) {
      const worker = this.worker
      this.worker = null
      this.hooks = null
      const tempPath = this.currentTempFilePath
      this.currentTempFilePath = null
      try {
        await worker.terminate()
      } finally {
        if (tempPath !== null) {
          try {
            rmSync(tempPath, { force: true })
          } catch {
            // ignore
          }
        }
      }
    }
  }
}
