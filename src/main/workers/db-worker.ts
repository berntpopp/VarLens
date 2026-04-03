/**
 * Piscina db-worker — runs read-only queries on its own SQLite connection.
 *
 * Each worker thread opens an independent database handle so reads can
 * proceed in parallel without blocking the Electron main thread.
 *
 * Writes stay on the main thread; this worker only handles SELECT queries.
 */

import Database from 'better-sqlite3-multiple-ciphers'
import { workerData } from 'worker_threads'
import { existsSync } from 'fs'
import { DATABASE_CONFIG } from '../../shared/config'
import { createRepositories } from '../database/createRepositories'
import { GeneReferenceDb } from '../database/GeneReferenceDb'
import type { DbTask } from '../../shared/types/db-task'
import { dispatchTask } from './db-worker-dispatch'

// ── Initialise connection from workerData ──────────────────────

const { dbPath, encryptionKey, geneRefDbPath } = workerData as {
  dbPath: string
  encryptionKey?: string
  /** Path to the bundled gene_reference.db — resolved on the main thread
   *  and forwarded here because Electron's `app` is not available in workers */
  geneRefDbPath?: string
}

const db = new Database(dbPath)

// CRITICAL: Encryption key must be the FIRST pragma issued
if (encryptionKey !== undefined && encryptionKey !== '') {
  const safeKey = encryptionKey.split("'").join("''")
  db.pragma(`key='${safeKey}'`)
}

// Performance PRAGMAs (WAL, read-optimised)
db.pragma('journal_mode = WAL')
db.pragma('synchronous = NORMAL')
db.pragma(`cache_size = ${DATABASE_CONFIG.CACHE_SIZE_KB}`)
db.pragma(`mmap_size = ${DATABASE_CONFIG.MMAP_SIZE_BYTES}`)
db.pragma(`busy_timeout = ${DATABASE_CONFIG.BUSY_TIMEOUT_MS}`)
db.pragma('foreign_keys = ON')
// Allow dirty reads from WAL — workers are read-only and tolerate stale data
db.pragma('read_uncommitted = ON')
// Enforce read-only: accidental writes from a new/incorrect task type fail fast
db.pragma('query_only = ON')

const repos = createRepositories(db)

// ── Gene reference DB (for panel interval computation) ────────
// Opened from the path forwarded via workerData. The main thread resolves
// the path using Electron's `app` module (not available in worker threads).

function openGeneRefDb(): GeneReferenceDb | null {
  if (geneRefDbPath === undefined || !existsSync(geneRefDbPath)) return null
  try {
    const raw = new Database(geneRefDbPath, { readonly: true, fileMustExist: true })
    return new GeneReferenceDb(raw)
  } catch (e) {
    console.warn(
      '[db-worker] Failed to open gene reference DB (panel interval computation will be skipped):',
      e instanceof Error ? e.message : String(e)
    )
    return null
  }
}

const geneRefDb: GeneReferenceDb | null = openGeneRefDb()

// ── Task dispatcher ────────────────────────────────────────────

export default function run(task: DbTask): unknown {
  return dispatchTask({ db, repos, geneRefDb }, task)
}
