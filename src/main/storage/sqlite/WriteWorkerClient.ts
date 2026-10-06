import { Worker } from 'worker_threads'
import { mainLogger } from '../../services/MainLogger'
import { decodeWorkerError } from '../../database/worker-error-codec'
import type {
  WriteWorkerData,
  WriteWorkerRequest,
  WriteWorkerResponse
} from '../../workers/write-worker-protocol'
import type { StorageWriteTask } from '../write-executor'
import type { AuthWriteOp } from '../../services/auth/auth-writes'

interface Pending {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

/**
 * Main-thread handle to the single SQLite writer thread. The worker is
 * spawned lazily on the first write and respawned after a crash; `close()`
 * terminates it (session close, re-key).
 */
export class WriteWorkerClient {
  private worker: Worker | null = null
  private nextId = 1
  private readonly pending = new Map<number, Pending>()

  constructor(
    private readonly workerPath: string,
    private readonly getWorkerData: () => WriteWorkerData
  ) {}

  run(task: StorageWriteTask): Promise<unknown> {
    return this.post((id) => ({ id, task }))
  }

  runAuth(auth: AuthWriteOp): Promise<unknown> {
    return this.post((id) => ({ id, auth }))
  }

  private post(build: (id: number) => WriteWorkerRequest): Promise<unknown> {
    const worker = this.ensureWorker()
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      worker.postMessage(build(id))
    })
  }

  async close(): Promise<void> {
    const worker = this.worker
    this.worker = null
    if (worker === null) return
    this.failPending(new Error('SQLite write worker closed'))
    await worker.terminate()
  }

  private ensureWorker(): Worker {
    if (this.worker !== null) return this.worker

    const worker = new Worker(this.workerPath, { workerData: this.getWorkerData() })
    worker.on('message', (response: WriteWorkerResponse) => {
      const entry = this.pending.get(response.id)
      if (entry === undefined) return
      this.pending.delete(response.id)
      if (response.ok) entry.resolve(response.result)
      else entry.reject(decodeWorkerError(response.error))
    })
    worker.on('error', (error: Error) => {
      mainLogger.error(`SQLite write worker error: ${error.message}`, 'WriteWorkerClient')
      this.discard(worker, error)
    })
    worker.on('exit', (code) => {
      if (this.worker === worker) {
        mainLogger.warn(`SQLite write worker exited (code ${code})`, 'WriteWorkerClient')
        this.discard(worker, new Error(`SQLite write worker exited with code ${code}`))
      }
    })
    // The writer must never keep the app alive on quit.
    worker.unref()
    this.worker = worker
    return worker
  }

  private discard(worker: Worker, error: Error): void {
    if (this.worker !== worker) return
    this.worker = null
    this.failPending(error)
  }

  private failPending(error: Error): void {
    for (const entry of this.pending.values()) entry.reject(error)
    this.pending.clear()
  }
}
