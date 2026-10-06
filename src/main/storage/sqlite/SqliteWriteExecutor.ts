import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import type { DatabaseService } from '../../database/DatabaseService'
import type { StorageWriteExecutor, StorageWriteTask } from '../write-executor'
import { executeSqliteWriteTask } from './sqlite-write-dispatch'
import { WriteWorkerClient } from './WriteWorkerClient'
import {
  applyAuthWrite,
  type AuthWriteOp,
  type AuthWriteResult
} from '../../services/auth/auth-writes'

export interface SqliteWriteExecutorOptions {
  /**
   * Path to the bundled write worker. Defaults to `write-worker.js` next to
   * the main bundle; `null` forces in-process execution (unit tests).
   */
  workerPath?: string | null
}

function defaultWorkerPath(): string | null {
  const candidate = resolve(__dirname, 'write-worker.js')
  // Vitest runs the TypeScript sources, where no bundle exists: fall back to
  // in-process execution there. Packaged/dev builds always ship the bundle.
  return existsSync(candidate) ? candidate : null
}

/**
 * SQLite `StorageWriteExecutor`.
 *
 * Writes are serialised (one in flight, FIFO) and, in the built app, executed
 * by the single writer thread (`write-worker.ts`), so the Electron main thread
 * never runs a write statement or waits on a SQLite lock for one.
 */
export class SqliteWriteExecutor implements StorageWriteExecutor {
  private writeTail: Promise<void> = Promise.resolve()
  private readonly worker: WriteWorkerClient | null

  constructor(
    private readonly databaseService: DatabaseService,
    options: SqliteWriteExecutorOptions = {}
  ) {
    const workerPath = options.workerPath === undefined ? defaultWorkerPath() : options.workerPath
    this.worker =
      workerPath === null
        ? null
        : new WriteWorkerClient(workerPath, () => ({
            dbPath: databaseService.getPath(),
            encryptionKey: databaseService.getEncryptionKey()
          }))
  }

  /** True when writes run on the dedicated writer thread. */
  get usesWorker(): boolean {
    return this.worker !== null
  }

  execute(task: StorageWriteTask): Promise<unknown> {
    return this.enqueue(() => this.executeTask(task))
  }

  /** Desktop auth writes (login bookkeeping, user admin) on the same FIFO writer. */
  executeAuthWrite(op: AuthWriteOp): Promise<AuthWriteResult> {
    return this.enqueue(async () =>
      this.worker !== null
        ? ((await this.worker.runAuth(op)) as AuthWriteResult)
        : applyAuthWrite(this.databaseService.database, op)
    )
  }

  private enqueue<T>(run: () => Promise<T>): Promise<T> {
    const result = this.writeTail.then(run)
    this.writeTail = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }

  /**
   * Run `operation` in the write queue with the writer thread stopped: queued
   * writes drain first, later ones wait behind it, and the writer's connection
   * is closed for its duration. The next write respawns the thread, re-reading
   * the encryption key (this is how a re-key reaches the writer).
   */
  runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    return this.enqueue(async () => {
      await this.worker?.close()
      return operation()
    })
  }

  /** Stop the writer thread after the queued writes drain. The next write respawns it. */
  async close(): Promise<void> {
    await this.writeTail
    await this.worker?.close()
  }

  private executeTask(task: StorageWriteTask): Promise<unknown> {
    if (this.worker !== null) return this.worker.run(task)
    return executeSqliteWriteTask(this.databaseService, task)
  }
}
