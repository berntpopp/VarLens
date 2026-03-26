import { Worker } from 'worker_threads'
import { resolve } from 'path'
import type {
  WorkerMessage,
  MainMessage,
  FileImportRequest
} from '../../shared/types/import-worker'
import { mainLogger } from '../services/MainLogger'

export interface ImportWorkerCallbacks {
  files: FileImportRequest[]
  dbPath: string
  encryptionKey?: string
  throttleMs: number
  batchSize?: number
  onProgress: (msg: Extract<WorkerMessage, { type: 'progress' }>) => void
  onFileComplete: (msg: Extract<WorkerMessage, { type: 'file-complete' }>) => void
  onComplete: (msg: Extract<WorkerMessage, { type: 'complete' }>) => void
  onError: (msg: Extract<WorkerMessage, { type: 'error' }>) => void
}

export class ImportWorkerClient {
  private worker: Worker | null = null
  private readonly workerPath: string

  constructor() {
    this.workerPath = resolve(__dirname, 'import-worker.js')
  }

  get isRunning(): boolean {
    return this.worker !== null
  }

  start(callbacks: ImportWorkerCallbacks): void {
    if (this.worker !== null) {
      throw new Error('Import worker is already running')
    }

    this.worker = new Worker(this.workerPath)

    this.worker.on('message', (msg: WorkerMessage) => {
      switch (msg.type) {
        case 'progress':
          callbacks.onProgress(msg)
          break
        case 'file-complete':
          callbacks.onFileComplete(msg)
          break
        case 'complete':
          callbacks.onComplete(msg)
          this.cleanup()
          break
        case 'error':
          callbacks.onError(msg)
          if (msg.fileIndex === -1) {
            this.cleanup()
          }
          break
      }
    })

    this.worker.on('error', (err: Error) => {
      mainLogger.error(`Import worker error: ${err.message}`, 'ImportWorkerClient')
      callbacks.onError({
        type: 'error',
        fileIndex: -1,
        error: err.message,
        phase: 'worker',
        stack: err.stack
      })
      this.cleanup()
    })

    this.worker.on('exit', (code) => {
      if (code !== 0 && this.worker !== null) {
        mainLogger.error(`Import worker exited with code ${code}`, 'ImportWorkerClient')
      }
      this.worker = null
    })

    const startMsg: MainMessage = {
      type: 'start',
      files: callbacks.files,
      dbPath: callbacks.dbPath,
      encryptionKey: callbacks.encryptionKey,
      throttleMs: callbacks.throttleMs,
      batchSize: callbacks.batchSize
    }

    this.worker.postMessage(startMsg)
  }

  cancel(): void {
    if (this.worker !== null) {
      this.worker.postMessage({ type: 'cancel' } satisfies MainMessage)
    }
  }

  private cleanup(): void {
    if (this.worker !== null) {
      this.worker.terminate().catch((e) => {
        console.warn('Worker termination failed:', e)
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
