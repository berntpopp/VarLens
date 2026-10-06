/**
 * Single SQLite writer thread.
 *
 * Every user-initiated write on a SQLite database (`StorageWriteTask`: tags,
 * annotations, comments, panels, presets, gene lists, case metadata, …) is
 * executed here, one task at a time, on this worker's own connection. The
 * Electron main thread only posts the task and awaits the reply, so a write
 * that has to wait for an import/delete worker's lock (`busy_timeout`) waits
 * here instead of freezing the app (audit 05, M-4).
 *
 * Bulk jobs (import, delete, summary rebuild) still use their own dedicated
 * workers; SQLite serialises them against this writer through its file lock.
 */
import { parentPort, workerData } from 'worker_threads'
import Database from 'better-sqlite3-multiple-ciphers'
import { DATABASE_CONFIG } from '../../shared/config'
import { createRepositories } from '../database/createRepositories'
import { assertNotHexLiteralKey } from '../database/sqlcipher-key-guard'
import { encodeWorkerError } from '../database/worker-error-codec'
import { executeSqliteWriteTask } from '../storage/sqlite/sqlite-write-dispatch'
import type {
  WriteWorkerData,
  WriteWorkerRequest,
  WriteWorkerResponse
} from './write-worker-protocol'

/**
 * Off the main thread a lock wait is harmless, so the writer waits much
 * longer than the main connection would before giving up with SQLITE_BUSY —
 * long enough to outlast an import's FTS/summary rebuild phase.
 */
export const WRITE_WORKER_BUSY_TIMEOUT_MS = 60_000

if (!parentPort) throw new Error('Must be run as worker thread')

const port = parentPort
const { dbPath, encryptionKey } = workerData as WriteWorkerData

if (encryptionKey !== undefined && encryptionKey !== '') {
  assertNotHexLiteralKey(encryptionKey)
}

const db = new Database(dbPath)
if (encryptionKey !== undefined && encryptionKey !== '') {
  // CRITICAL: the key must be the first pragma issued.
  db.pragma(`key='${encryptionKey.split("'").join("''")}'`)
}
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')
db.pragma('synchronous = NORMAL')
db.pragma(`busy_timeout = ${WRITE_WORKER_BUSY_TIMEOUT_MS}`)
db.pragma(`cache_size = ${DATABASE_CONFIG.CACHE_SIZE_KB}`)
db.pragma('temp_store = MEMORY')

const repos = createRepositories(db)

// Tasks are processed strictly in arrival order: the main-side client only
// sends the next task after the previous reply, and this chain guarantees
// ordering even for the few async tasks (BED import streams a file).
let tail: Promise<void> = Promise.resolve()

port.on('message', (request: WriteWorkerRequest) => {
  tail = tail.then(async () => {
    let response: WriteWorkerResponse
    try {
      const result = await executeSqliteWriteTask(repos, request.task)
      response = { id: request.id, ok: true, result }
    } catch (error) {
      response = { id: request.id, ok: false, error: encodeWorkerError(error) }
    }
    port.postMessage(response)
  })
})

port.on('close', () => {
  db.close()
})
