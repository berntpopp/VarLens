import { Pool } from 'pg'

import { assertPostgresMigrationCompatible } from './assertMigrationCompatible'
import { buildPostgresPoolConfig, type PostgresStorageConfig } from '../config'
import { classifyPostgresFailureMessage } from './PostgresHealthDiagnostics'
import { PostgresStorageSession } from './PostgresStorageSession'
import { POSTGRES_MIGRATIONS } from './migrations/definitions'
import { PostgresMigrationRunner } from './migrations/PostgresMigrationRunner'
import type { PostgresMigration } from './migrations/types'
import type { PostgresPublicAnnotationRepository } from './PostgresPublicAnnotationRepository'
import { wrapPoolForCounters } from './query-counters'

export async function createPostgresStorageSession(
  config: PostgresStorageConfig,
  options: {
    publicAnnotations?: PostgresPublicAnnotationRepository
    migrations?: readonly PostgresMigration[]
  } = {}
): Promise<PostgresStorageSession> {
  const pool = new Pool(buildPostgresPoolConfig(config))

  try {
    const migrationResult = await new PostgresMigrationRunner(
      pool,
      config.schema,
      options.migrations ?? POSTGRES_MIGRATIONS
    ).migrate()

    const wrappedPool = wrapPoolForCounters(pool)

    return new PostgresStorageSession({
      config,
      pool: wrappedPool,
      migrationResult,
      ...(options.publicAnnotations !== undefined
        ? { publicAnnotations: options.publicAnnotations }
        : {})
    })
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

export async function openPostgresStorageSessionWithoutMigrating(
  config: PostgresStorageConfig,
  options: {
    publicAnnotations?: PostgresPublicAnnotationRepository
    validateMigrationCompat?: boolean
  } = {}
): Promise<PostgresStorageSession> {
  const pool = new Pool(buildPostgresPoolConfig(config))

  if (options.validateMigrationCompat === true) {
    try {
      await assertPostgresMigrationCompatible(pool, config.schema)
    } catch (error) {
      try {
        await pool.end()
      } catch {
        // Ignore cleanup failures; the original compat error is more useful.
      }
      throw toPostgresFailureError(error)
    }
  }

  return new PostgresStorageSession({
    config,
    pool: wrapPoolForCounters(pool),
    ...(options.publicAnnotations !== undefined
      ? { publicAnnotations: options.publicAnnotations }
      : {})
  })
}

function toPostgresFailureError(error: unknown): Error {
  const message = classifyPostgresFailureMessage(error)
  if (error instanceof Error) {
    error.message = message
    return error
  }

  return new Error(message)
}
