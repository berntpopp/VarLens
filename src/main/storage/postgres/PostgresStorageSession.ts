import type { Pool } from 'pg'

import { mainLogger } from '../../services/MainLogger'
import type { DatabaseService } from '../../database/DatabaseService'
import type { DbPool } from '../../database/DbPool'
import type { Case } from '../../../shared/types/database'
import { PostgresAvailableBuildsRepository } from './PostgresAvailableBuildsRepository'
import { PostgresCaseListRepository } from './PostgresCaseListRepository'
import { PostgresCasesQueryRepository } from './PostgresCasesQueryRepository'
import { PostgresReadExecutor } from './PostgresReadExecutor'
import type { StorageReadExecutor } from '../read-executor'
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
  createCaseListRepository?: (pool: Pool, schema: string) => PostgresCaseListRepository
}

const POSTGRES_CAPABILITIES: StorageCapabilities = {
  backend: 'postgres',
  supportsEncryptionAtRest: false,
  supportsLocalFileLifecycle: false,
  supportsHostedConnectionLifecycle: true,
  supportsWorkerReadPool: false,
  supportsFileBackedWorkerWrites: false,
  supportsFullTextSearch: false
}

function unsupported(message: string): never {
  throw new Error(message)
}

export class PostgresStorageSession implements StorageSession {
  readonly capabilities = POSTGRES_CAPABILITIES
  readonly workspace: WorkspaceRef

  private readonly createCaseListRepository: (
    pool: Pool,
    schema: string
  ) => PostgresCaseListRepository
  private readonly pool: Pool
  private readonly readExecutor: StorageReadExecutor
  private cases: PostgresCaseListRepository | null = null

  constructor(options: PostgresStorageSessionOptions) {
    this.pool = options.pool
    this.readExecutor = new PostgresReadExecutor({
      casesQuery: new PostgresCasesQueryRepository(options.pool, options.config.schema),
      availableBuilds: new PostgresAvailableBuildsRepository(options.pool, options.config.schema)
    })
    this.createCaseListRepository =
      options.createCaseListRepository ??
      ((pool: Pool, schema: string) => new PostgresCaseListRepository(pool, schema))

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

  async listCases(): Promise<Case[]> {
    if (this.cases === null) {
      this.cases = this.createCaseListRepository(
        this.pool,
        this.workspace.kind === 'postgres' ? this.workspace.schema : 'public'
      )
    }

    return await this.cases.listCases()
  }

  getReadExecutor(): StorageReadExecutor {
    return this.readExecutor
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
