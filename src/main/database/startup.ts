import { join } from 'node:path'
import { Pool } from 'pg'

import type { DatabaseManager } from '../services/DatabaseManager'
import {
  buildPostgresPoolConfig,
  getPostgresStorageConfig,
  type PostgresStorageConfig
} from '../storage/config'
import { PostgresStorageSession } from '../storage/postgres/PostgresStorageSession'
import type { StorageSession } from '../storage/session'

interface OpenConfiguredDatabaseOptions {
  env?: NodeJS.ProcessEnv
  userDataPath: string
  getPostgresConfig?: (env: NodeJS.ProcessEnv) => PostgresStorageConfig | null
  createPostgresPool?: (config: PostgresStorageConfig) => Pool
  createPostgresSession?: (config: PostgresStorageConfig, pool: Pool) => StorageSession
}

function getExperimentalBackend(env: NodeJS.ProcessEnv): string | null {
  const backend = env.VARLENS_EXPERIMENTAL_STORAGE_BACKEND?.trim()
  return backend === undefined || backend === '' ? null : backend
}

export async function openConfiguredDatabase(
  manager: DatabaseManager,
  options: OpenConfiguredDatabaseOptions
): Promise<void> {
  const env = options.env ?? process.env
  const requestedBackend = getExperimentalBackend(env)

  if (requestedBackend === 'postgres') {
    const config = (options.getPostgresConfig ?? getPostgresStorageConfig)(env)

    if (config === null) {
      throw new Error(
        'VARLENS_EXPERIMENTAL_STORAGE_BACKEND=postgres requires PostgreSQL configuration, including VARLENS_PG_URL'
      )
    }

    const poolFactory =
      options.createPostgresPool ??
      ((pgConfig: PostgresStorageConfig) => new Pool(buildPostgresPoolConfig(pgConfig)))
    const sessionFactory =
      options.createPostgresSession ??
      ((pgConfig: PostgresStorageConfig, pool: Pool) =>
        new PostgresStorageSession({ config: pgConfig, pool }))

    const pool = poolFactory(config)
    let session: StorageSession | undefined

    try {
      session = sessionFactory(config, pool)
      await manager.openPostgresSession(session)
      return
    } catch (error) {
      if (session !== undefined) {
        await session.close()
      } else {
        await pool.end()
      }
      throw error
    }
  }

  await manager.open(join(options.userDataPath, 'varlens.db'))
}
