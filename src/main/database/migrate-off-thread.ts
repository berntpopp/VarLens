/**
 * Run the SQLite schema/migration pass in `migration-worker.js` and wait for
 * it, so the main thread only ever opens an already-current database.
 *
 * Best-effort by design: when the worker is unavailable (tests without a
 * bundled worker, ':memory:') or fails (wrong key, corrupt file), this
 * resolves with `ran: false` and the caller's normal DatabaseService
 * construction runs the migrations on main and raises the canonical error
 * (e.g. WrongPasswordError) exactly as before.
 */
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { Worker } from 'node:worker_threads'
import { mainLogger } from '../services/MainLogger'
import type {
  MigrationWorkerRequest,
  MigrationWorkerResponse
} from '../workers/migration-worker-protocol'

export interface OffThreadMigrationResult {
  ran: boolean
  fromVersion?: number
  toVersion?: number
  elapsedMs?: number
  error?: string
}

let workerPathOverride: string | undefined

/** Test hook: point at a bundled worker (undefined restores the default). */
export function setMigrationWorkerPathForTesting(path: string | undefined): void {
  workerPathOverride = path
}

export function migrateSqliteOffThread(
  dbPath: string,
  encryptionKey?: string
): Promise<OffThreadMigrationResult> {
  const workerPath = workerPathOverride ?? resolve(__dirname, 'migration-worker.js')
  if (dbPath === ':memory:' || dbPath === '' || !existsSync(workerPath)) {
    return Promise.resolve({ ran: false })
  }

  return new Promise((done) => {
    const worker = new Worker(workerPath)
    let settled = false
    const finish = (result: OffThreadMigrationResult): void => {
      if (settled) return
      settled = true
      done(result)
      worker.terminate().catch(() => undefined)
    }

    worker.once('message', (msg: MigrationWorkerResponse) => {
      if (msg.type === 'done') {
        if (msg.toVersion !== msg.fromVersion) {
          mainLogger.info(
            `Migrated database v${msg.fromVersion} → v${msg.toVersion} off the main thread in ${msg.elapsedMs} ms`,
            'database-startup'
          )
        }
        finish({ ran: true, ...msg })
      } else {
        finish({ ran: false, error: msg.error })
      }
    })
    worker.once('error', (error: Error) => finish({ ran: false, error: error.message }))
    worker.once('exit', (code) =>
      finish({ ran: false, error: `migration worker exited with code ${code}` })
    )
    worker.postMessage({ dbPath, encryptionKey } satisfies MigrationWorkerRequest)
  })
}
