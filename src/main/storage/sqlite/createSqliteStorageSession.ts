import { DatabaseService } from '../../database/DatabaseService'
import { DbPool } from '../../database/DbPool'
import { WrongPasswordError } from '../../database/errors'
import { resolveGeneRefDbPath } from '../../database/geneReferenceLoader'
import { isNotADatabaseError } from '../../database/sqlite-error'
import { getWorkerThreads } from '../../ipc/dbPoolManager'
import { SqliteStorageSession } from './SqliteStorageSession'

const hasKey = (key?: string): key is string => key !== undefined && key.length > 0

/** Worker-bundle overrides for tests; production resolves both next to the main bundle. */
export interface SqliteStorageSessionWorkerPaths {
  dbWorkerPath?: string
  writeWorkerPath?: string | null
}

export function createSqliteStorageSession(
  dbPath: string,
  key?: string,
  workerPaths: SqliteStorageSessionWorkerPaths = {}
): SqliteStorageSession {
  // A wrong/missing key against an actually-encrypted file fails INSIDE the
  // DatabaseService constructor (the `journal_mode` pragma is what triggers
  // SQLite's read validation) -- so this must wrap the constructor call
  // itself, not just a query issued after it succeeds.
  let databaseService: DatabaseService
  try {
    databaseService = new DatabaseService(dbPath, key)
  } catch (error) {
    if (hasKey(key) && isNotADatabaseError(error)) {
      throw new WrongPasswordError()
    }
    throw error
  }

  if (hasKey(key)) {
    try {
      databaseService.database.prepare('SELECT count(*) FROM sqlite_master').get()
    } catch (error) {
      databaseService.close()

      if (isNotADatabaseError(error)) {
        throw new WrongPasswordError()
      }

      throw error
    }
  }

  let geneRefDbPath: string | undefined
  try {
    geneRefDbPath = resolveGeneRefDbPath()
  } catch {
    geneRefDbPath = undefined
  }

  const configuredWorkerThreads = getWorkerThreads()
  const maxThreads = configuredWorkerThreads > 0 ? configuredWorkerThreads : undefined
  const dbPool = new DbPool()

  dbPool.init(dbPath, key, {
    ...(maxThreads !== undefined ? { maxThreads } : {}),
    ...(geneRefDbPath !== undefined ? { geneRefDbPath } : {}),
    ...(workerPaths.dbWorkerPath !== undefined ? { workerPath: workerPaths.dbWorkerPath } : {})
  })

  return new SqliteStorageSession({
    databaseService,
    dbPool,
    ...(workerPaths.writeWorkerPath !== undefined
      ? { writeWorkerPath: workerPaths.writeWorkerPath }
      : {})
  })
}
