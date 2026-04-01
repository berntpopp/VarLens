/**
 * DbPool — Piscina-based worker pool for off-thread read queries.
 *
 * Each worker opens its own SQLite connection (with encryption support)
 * and uses the shared createRepositories factory. The pool is configured
 * with 1 to (cpuCount - 1) threads (minimum 1) and a configurable idle timeout.
 *
 * Usage:
 *   pool.init(dbPath, encryptionKey)
 *   const result = await pool.run<MyType>({ type: 'variants:query', params: [...] })
 *   await pool.destroy()
 */

import { resolve } from 'path'
import os from 'os'
import type { DbTask } from '../../shared/types/db-task'
import { DATABASE_CONFIG } from '../../shared/config'

// Use require() to load piscina — avoids Vite's static import analysis
// which cannot resolve Node.js-only modules during test transforms

let PiscinaClass: (new (opts: Record<string, unknown>) => PiscinaInstance) | null = null

interface PiscinaInstance {
  run: (task: DbTask) => Promise<unknown>
  destroy: () => Promise<void>
}

function getPiscina(): new (opts: Record<string, unknown>) => PiscinaInstance {
  if (PiscinaClass === null) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    PiscinaClass = require('piscina') as typeof PiscinaClass
  }
  return PiscinaClass!
}

export class DbPool {
  private pool: PiscinaInstance | null = null

  /**
   * Initialise the worker pool.
   *
   * @param dbPath        Absolute path to the SQLite database file.
   * @param encryptionKey Optional encryption key (passed via workerData).
   * @param options       Optional overrides (workerPath, execArgv, maxThreads, geneRefDbPath) for tests or config.
   */
  init(
    dbPath: string,
    encryptionKey?: string,
    options?: {
      workerPath?: string
      execArgv?: string[]
      maxThreads?: number
      /** Path to the bundled gene_reference.db, forwarded to the worker for panel interval computation */
      geneRefDbPath?: string
    }
  ): void {
    if (this.pool !== null) return // already initialised

    const filename = options?.workerPath ?? resolve(__dirname, 'db-worker.js')
    const Piscina = getPiscina()
    const maxThreads = options?.maxThreads ?? Math.max(1, os.cpus().length - 1)

    this.pool = new Piscina({
      filename,
      minThreads: 1,
      maxThreads,
      idleTimeout: DATABASE_CONFIG.WORKER_IDLE_TIMEOUT_MS,
      workerData: { dbPath, encryptionKey, geneRefDbPath: options?.geneRefDbPath },
      ...(options?.execArgv !== undefined ? { execArgv: options.execArgv } : {})
    })
  }

  /**
   * Check whether the pool has been initialised.
   */
  isInitialised(): boolean {
    return this.pool !== null
  }

  /**
   * Dispatch a read-only task to the pool.
   */
  async run<T>(task: DbTask): Promise<T> {
    if (this.pool === null) throw new Error('DbPool not initialized — call init() first')
    return this.pool.run(task) as Promise<T>
  }

  /**
   * Destroy the pool and close all worker connections.
   */
  async destroy(): Promise<void> {
    if (this.pool !== null) {
      await this.pool.destroy()
      this.pool = null
    }
  }
}
