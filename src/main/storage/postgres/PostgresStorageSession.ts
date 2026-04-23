import type { Pool } from 'pg'

import { mainLogger } from '../../services/MainLogger'
import type { DatabaseService } from '../../database/DatabaseService'
import type { DbPool } from '../../database/DbPool'
import {
  buildPostgresConnectionLabel,
  redactPostgresConnectionUrl,
  type PostgresStorageConfig
} from '../config'
import type { StorageSession } from '../session'
import type { StorageCapabilities, StorageHealth, WorkspaceRef } from '../types'

interface PostgresStorageSessionOptions {
  config: PostgresStorageConfig
  pool: Pool
}

const POSTGRES_CAPABILITIES: StorageCapabilities = {
  backend: 'postgres',
  supportsEncryptionAtRest: false,
  supportsLocalFileLifecycle: false,
  supportsHostedConnectionLifecycle: true,
  supportsWorkerReadPool: false,
  supportsFullTextSearch: false
}

function unsupported(message: string): never {
  throw new Error(message)
}

export class PostgresStorageSession implements StorageSession {
  readonly capabilities = POSTGRES_CAPABILITIES
  readonly workspace: WorkspaceRef

  private readonly pool: Pool

  constructor(options: PostgresStorageSessionOptions) {
    this.pool = options.pool

    const connectionUrlRedacted = redactPostgresConnectionUrl(options.config.url)

    this.workspace = {
      kind: 'postgres',
      connectionUrlRedacted,
      connectionLabel: buildPostgresConnectionLabel(connectionUrlRedacted, options.config.schema),
      schema: options.config.schema
    }

    this.pool.on('error', (error: Error) => {
      const message = error instanceof Error ? error.message : String(error)
      mainLogger.warn(`Postgres pool error: ${message}`, 'storage')
    })
  }

  getDatabaseService(): DatabaseService {
    return unsupported('DatabaseService is not available for postgres sessions')
  }

  getDbPool(): DbPool | null {
    return unsupported('DbPool is not available for postgres sessions')
  }

  getEncryptionKey(): string | undefined {
    return unsupported('Encryption keys are not available for postgres sessions')
  }

  needsStartupRebuild(): boolean {
    return unsupported('Startup rebuild is not supported for postgres sessions')
  }

  rekey(_newPassword: string): void {
    unsupported('SQLite rekey is not supported for postgres sessions')
  }

  async close(): Promise<void> {
    await this.pool.end()
  }

  async health(): Promise<StorageHealth> {
    const startedAt = Date.now()

    try {
      await this.pool.query('SELECT 1')

      return {
        ok: true,
        backend: 'postgres',
        roundTripMs: Date.now() - startedAt
      }
    } catch (error) {
      return {
        ok: false,
        backend: 'postgres',
        message: error instanceof Error ? error.message : String(error),
        roundTripMs: Date.now() - startedAt
      }
    }
  }
}
