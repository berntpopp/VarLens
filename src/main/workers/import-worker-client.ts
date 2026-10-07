import { Worker, type ResourceLimits } from 'worker_threads'
import { resolve } from 'path'
import type {
  WorkerMessage,
  MainMessage,
  FileImportRequest
} from '../../shared/types/import-worker'
import { mainLogger } from '../services/MainLogger'
import { describeWorkerCrash } from '../storage/import-worker-errors'
import { importWorkerResourceLimits } from './import-worker-limits'

export interface ImportWorkerCallbacks {
  files: FileImportRequest[]
  dbPath: string
  encryptionKey?: string
  throttleMs: number
  batchSize?: number
  onProgress: (msg: Extract<WorkerMessage, { type: 'progress' }>) => void
  onFileComplete: (msg: Extract<WorkerMessage, { type: 'file-complete' }>) => void
  /** The worker flagged the cohort summary stale; it rebuilds before `onComplete`. */
  onSummaryStale?: () => void
  onComplete: (msg: Extract<WorkerMessage, { type: 'complete' }>) => void
  onError: (msg: Extract<WorkerMessage, { type: 'error' }>) => void
}

export interface ImportWorkerClientOptions {
  /** Worker bundle to run. Default: the built `import-worker.js`. */
  workerPath?: string
  /** Heap limits for the worker. Default: sized from physical memory. */
  resourceLimits?: ResourceLimits
}

type ImportWorkerErrorMessage = Extract<WorkerMessage, { type: 'error' }>

export class ImportWorkerClient {
  private worker: Worker | null = null
  private readonly workerPath: string
  private readonly resourceLimits: ResourceLimits

  constructor(options: ImportWorkerClientOptions = {}) {
    this.workerPath = options.workerPath ?? resolve(__dirname, 'import-worker.js')
    this.resourceLimits = options.resourceLimits ?? importWorkerResourceLimits()
  }

  get isRunning(): boolean {
    return this.worker !== null
  }

  start(callbacks: ImportWorkerCallbacks): void {
    if (this.worker !== null) {
      throw new Error('Import worker is already running')
    }

    const worker = this.spawn()
    // The case the worker is filling right now. If the worker dies before it
    // reports the file done, that case is partial and nobody inside the
    // worker is left to delete it.
    let partialCaseId: number | null = null

    worker.on('message', (msg: WorkerMessage) => {
      switch (msg.type) {
        case 'progress':
          callbacks.onProgress(msg)
          break
        case 'case-started':
          partialCaseId = msg.caseId
          break
        case 'file-complete':
          partialCaseId = null
          callbacks.onFileComplete(msg)
          break
        case 'summary-stale':
          callbacks.onSummaryStale?.()
          break
        case 'complete':
          callbacks.onComplete(msg)
          this.cleanup()
          break
        case 'error':
          // A per-file error means the worker already deleted that case.
          partialCaseId = null
          callbacks.onError(msg)
          if (msg.fileIndex === -1) {
            this.cleanup()
          }
          break
      }
    })

    worker.on('error', (err: Error) => {
      const crash = describeWorkerCrash(err)
      mainLogger.error(`Import worker error: ${crash.message}`, 'ImportWorkerClient')
      const failure: ImportWorkerErrorMessage = {
        type: 'error',
        fileIndex: -1,
        error: crash.message,
        phase: 'worker',
        stack: err.stack,
        ...(crash.code !== undefined
          ? { errorCode: crash.code, userMessage: crash.userMessage }
          : {})
      }
      this.cleanup()
      if (partialCaseId === null) {
        callbacks.onError(failure)
      } else {
        this.discardPartialCase(callbacks, partialCaseId, () => callbacks.onError(failure))
      }
    })

    const startMsg: MainMessage = {
      type: 'start',
      files: callbacks.files,
      dbPath: callbacks.dbPath,
      encryptionKey: callbacks.encryptionKey,
      throttleMs: callbacks.throttleMs,
      batchSize: callbacks.batchSize
    }

    worker.postMessage(startMsg)
  }

  cancel(): void {
    if (this.worker !== null) {
      this.worker.postMessage({ type: 'cancel' } satisfies MainMessage)
    }
  }

  private spawn(): Worker {
    const worker = new Worker(this.workerPath, { resourceLimits: this.resourceLimits })
    this.worker = worker
    worker.on('exit', (code) => {
      // Only the current worker may clear the slot: a crashed worker's exit
      // arrives after its recovery run has taken the slot over.
      if (this.worker !== worker) return
      if (code !== 0) {
        mainLogger.error(`Import worker exited with code ${code}`, 'ImportWorkerClient')
      }
      this.worker = null
    })
    return worker
  }

  /**
   * Roll back the case a crashed worker left half-written. A fresh worker
   * runs an import session with no files: it deletes the case, rebuilds FTS
   * and recreates the indexes the dead worker had dropped. `done` is called
   * exactly once, whether or not the recovery succeeded, so the import
   * failure is always reported.
   */
  private discardPartialCase(
    callbacks: ImportWorkerCallbacks,
    caseId: number,
    done: () => void
  ): void {
    let finished = false
    const finish = (problem?: string): void => {
      if (finished) return
      finished = true
      if (problem !== undefined) {
        mainLogger.error(
          `Could not discard partial case ${caseId} after an import worker crash: ${problem}`,
          'ImportWorkerClient'
        )
      }
      this.cleanup()
      done()
    }

    let recovery: Worker
    try {
      recovery = this.spawn()
    } catch (e) {
      finish(e instanceof Error ? e.message : String(e))
      return
    }
    recovery.on('message', (msg: WorkerMessage) => {
      if (msg.type === 'complete') finish()
      else if (msg.type === 'error') finish(msg.error)
    })
    recovery.on('error', (err: Error) => finish(err.message))
    recovery.on('exit', () => finish('recovery worker exited before completing'))
    recovery.postMessage({
      type: 'start',
      files: [],
      dbPath: callbacks.dbPath,
      encryptionKey: callbacks.encryptionKey,
      throttleMs: callbacks.throttleMs,
      discardCaseIds: [caseId]
    } satisfies MainMessage)
  }

  private cleanup(): void {
    if (this.worker !== null) {
      this.worker.terminate().catch((e) => {
        mainLogger.warn(
          `Worker termination failed: ${e instanceof Error ? e.message : String(e)}`,
          'import'
        )
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
