import { Pool } from 'pg'

import { buildPostgresPoolConfig, type PostgresStorageConfig } from '../config'
import { classifyPostgresFailureMessage } from './PostgresHealthDiagnostics'
import { PostgresStorageSession } from './PostgresStorageSession'
import { POSTGRES_MIGRATIONS } from './migrations/definitions'
import { PostgresMigrationRunner } from './migrations/PostgresMigrationRunner'
import { mainLogger } from '../../services/MainLogger'
import { wrapPoolForCounters } from './query-counters'

export async function createPostgresStorageSession(
  config: PostgresStorageConfig
): Promise<PostgresStorageSession> {
  const pool = new Pool(buildPostgresPoolConfig(config))

  try {
    const migrationResult = await new PostgresMigrationRunner(
      pool,
      config.schema,
      POSTGRES_MIGRATIONS
    ).migrate()

    const wrappedPool = wrapPoolForCounters(pool)

    const session = new PostgresStorageSession({
      config,
      pool: wrappedPool,
      migrationResult
    })

    try {
      await session.resumePendingDeletions()
    } catch (resumeError) {
      mainLogger.warn(
        `Failed to resume pending deletions on postgres startup: ${resumeError instanceof Error ? resumeError.message : String(resumeError)}`,
        'storage'
      )
    }

    return session
  } catch (error) {
    try {
      await pool.end()
    } catch (cleanupError) {
      const failureError = toPostgresFailureError(error)
      if (error instanceof Error) {
        const errorWithCleanup = failureError as Error & { cleanupError?: unknown }
        errorWithCleanup.cleanupError = cleanupError
        throw errorWithCleanup
      }

      const combinedError = new Error(
        'PostgreSQL session creation failed and cleanup failed'
      ) as Error & {
        errors: unknown[]
      }
      combinedError.errors = [error, cleanupError]
      throw combinedError
    }
    throw toPostgresFailureError(error)
  }
}

function toPostgresFailureError(error: unknown): Error {
  const message = classifyPostgresFailureMessage(error)
  if (error instanceof Error) {
    error.message = message
    return error
  }

  return new Error(message)
}
