/**
 * DbPool — Piscina-based worker pool for off-thread read queries.
 *
 * Each worker opens its own SQLite connection (with encryption support)
 * and uses the shared createRepositories factory. The pool is configured
 * with 1-4 threads and a 30-second idle timeout.
 *
 * Usage:
 *   pool.init(dbPath, encryptionKey)
 *   const result = await pool.run<MyType>({ type: 'variants:query', params: [...] })
 *   await pool.destroy()
 */

import Piscina from 'piscina'
import { resolve } from 'path'
import type { DbTask } from '../../shared/types/db-task'

export class DbPool {
  private pool: Piscina | null = null

  /**
   * Initialise the worker pool.
   *
   * @param dbPath     Absolute path to the SQLite database file.
   * @param encryptionKey  Optional encryption key (passed via workerData).
   * @param options    Optional overrides (workerPath, execArgv) for tests.
   */
  init(
    dbPath: string,
    encryptionKey?: string,
    options?: { workerPath?: string; execArgv?: string[] }
  ): void {
    if (this.pool) return // already initialised

    const filename = options?.workerPath ?? resolve(__dirname, 'db-worker.js')

    this.pool = new Piscina({
      filename,
      minThreads: 1,
      maxThreads: 4,
      idleTimeout: 30_000,
      workerData: { dbPath, encryptionKey },
      ...(options?.execArgv ? { execArgv: options.execArgv } : {})
    })
  }

  /**
   * Dispatch a read-only task to the pool.
   */
  async run<T>(task: DbTask): Promise<T> {
    if (!this.pool) throw new Error('DbPool not initialized — call init() first')
    return this.pool.run(task) as Promise<T>
  }

  /**
   * Destroy the pool and close all worker connections.
   */
  async destroy(): Promise<void> {
    if (this.pool) {
      await this.pool.destroy()
      this.pool = null
    }
  }
}
