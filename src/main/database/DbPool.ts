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
 *
 * An operation that needs the database file to itself (re-key) brackets its
 * work with `await pool.suspend()` / `pool.resume(key)`.
 */

import { resolve } from 'path'
import os from 'os'
import type { DbTask } from '../../shared/types/db-task'
import { DATABASE_CONFIG } from '../../shared/config'

// Use require() to load piscina — avoids Vite's static import analysis
// which cannot resolve Node.js-only modules during test transforms

interface PiscinaInstance {
  run: (task: DbTask) => Promise<unknown>
  destroy: () => Promise<void>
}

interface DbPoolInitOptions {
  filename: string
  minThreads: number
  maxThreads: number
  idleTimeout: number
  workerData: {
    dbPath: string
    encryptionKey?: string
    geneRefDbPath?: string
  }
  execArgv?: string[]
}

type PiscinaConstructor = new (opts: DbPoolInitOptions) => PiscinaInstance

let PiscinaClass: PiscinaConstructor | null = null

function getPiscina(): PiscinaConstructor {
  if (PiscinaClass === null) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    PiscinaClass = require('piscina') as typeof PiscinaClass
  }
  return PiscinaClass!
}

interface Suspension {
  released: Promise<void>
  release: () => void
}

export class DbPool {
  private pool: PiscinaInstance | null = null
  private initOptions: DbPoolInitOptions | null = null
  private suspension: Suspension | null = null
  private readonly inFlight = new Set<Promise<unknown>>()

  /**
   * Initialise the worker pool. Workers spawn lazily on the first `run()`.
   *
   * Calling it again replaces the configuration, as long as no worker from the
   * previous one is alive — a worker keeps the `workerData` (path, key) it was
   * spawned with, so a silent re-init would leave stale connections behind.
   *
   * @param dbPath        Absolute path to the SQLite database file.
   * @param encryptionKey Optional encryption key (passed via workerData).
   * @param options       Optional overrides (workerPath, execArgv, maxThreads, geneRefDbPath) for tests or config.
   * @throws if workers are alive; `destroy()` (or `suspend()`) first.
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
    if (this.pool !== null) {
      throw new Error('DbPool has live workers — call destroy() before init()')
    }

    const filename = options?.workerPath ?? resolve(__dirname, 'db-worker.js')
    const maxThreads = options?.maxThreads ?? Math.max(1, os.cpus().length - 1)

    this.initOptions = {
      filename,
      minThreads: 1,
      maxThreads,
      idleTimeout: DATABASE_CONFIG.WORKER_IDLE_TIMEOUT_MS,
      workerData: { dbPath, encryptionKey, geneRefDbPath: options?.geneRefDbPath },
      ...(options?.execArgv !== undefined ? { execArgv: options.execArgv } : {})
    }
  }

  /**
   * Check whether the pool has been initialised.
   */
  isInitialised(): boolean {
    return this.initOptions !== null
  }

  /**
   * Dispatch a read-only task to the pool. While the pool is suspended the
   * task waits for `resume()` rather than failing.
   */
  async run<T>(task: DbTask): Promise<T> {
    while (this.suspension !== null) await this.suspension.released

    if (this.initOptions === null) throw new Error('DbPool not initialized — call init() first')

    if (this.pool === null) {
      const Piscina = getPiscina()
      this.pool = new Piscina(this.initOptions)
    }

    const result = this.pool.run(task)
    this.inFlight.add(result)
    const forget = (): void => void this.inFlight.delete(result)
    result.then(forget, forget)
    return result as Promise<T>
  }

  /**
   * Close every worker connection and hold new reads until `resume()`.
   * Reads already running finish first. Keeps the configuration.
   */
  async suspend(): Promise<void> {
    if (this.suspension === null) {
      let release: () => void = () => undefined
      const released = new Promise<void>((done) => {
        release = done
      })
      this.suspension = { released, release }
    }

    await Promise.allSettled([...this.inFlight])
    await this.destroyWorkers()
  }

  /**
   * Release the reads held by `suspend()`. Workers respawn lazily and open
   * the database with `encryptionKey`.
   */
  resume(encryptionKey: string | undefined): void {
    if (this.initOptions !== null) {
      this.initOptions = {
        ...this.initOptions,
        workerData: { ...this.initOptions.workerData, encryptionKey }
      }
    }
    this.releaseSuspension()
  }

  /**
   * Destroy the pool and close all worker connections.
   */
  async destroy(): Promise<void> {
    await this.destroyWorkers()
    this.initOptions = null
    this.releaseSuspension()
  }

  private async destroyWorkers(): Promise<void> {
    const pool = this.pool
    this.pool = null
    if (pool !== null) await pool.destroy()
  }

  private releaseSuspension(): void {
    const suspension = this.suspension
    this.suspension = null
    suspension?.release()
  }
}
