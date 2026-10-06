/**
 * Worker thread that brings a SQLite database to the current schema
 * (initializeSchema + runMigrations) off the Electron main thread
 * (audit 05, M-6 follow-up).
 *
 * The main process awaits this worker before it constructs DatabaseService,
 * whose own schema/migration pass is then a cheap no-op. During startup the
 * IPC startup gate stays closed meanwhile, so the boot splash keeps painting
 * while a long migration (index builds, table rewrites) runs here.
 */
import { parentPort } from 'worker_threads'
import Database from 'better-sqlite3-multiple-ciphers'
import { initializeSchema } from '../database/schema'
import { runMigrations } from '../database/migrations'
import { applyConnectionPragmas } from '../database/connection-pragmas'
import { assertNotHexLiteralKey } from '../database/sqlcipher-key-guard'
import type { MigrationWorkerRequest, MigrationWorkerResponse } from './migration-worker-protocol'

if (!parentPort) throw new Error('Must be run as worker thread')

const port = parentPort

port.once('message', (msg: MigrationWorkerRequest) => {
  let response: MigrationWorkerResponse
  const started = Date.now()
  let db: Database.Database | null = null
  try {
    if (msg.encryptionKey !== undefined && msg.encryptionKey !== '') {
      assertNotHexLiteralKey(msg.encryptionKey)
    }
    db = new Database(msg.dbPath)
    applyConnectionPragmas(db, msg.encryptionKey)
    const fromVersion = db.pragma('user_version', { simple: true }) as number
    initializeSchema(db)
    runMigrations(db)
    const toVersion = db.pragma('user_version', { simple: true }) as number
    response = { type: 'done', fromVersion, toVersion, elapsedMs: Date.now() - started }
  } catch (error) {
    response = { type: 'error', error: error instanceof Error ? error.message : String(error) }
  } finally {
    try {
      db?.close()
    } catch (e) {
      console.warn(
        '[migration-worker] Failed to close database:',
        e instanceof Error ? e.message : String(e)
      )
    }
  }
  port.postMessage(response)
})
