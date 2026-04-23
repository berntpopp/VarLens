import type { DatabaseService } from '../../database/DatabaseService'
import type { DbPool } from '../../database/DbPool'
import type { StorageSession } from '../session'
import type { StorageCapabilities, StorageHealth, WorkspaceRef } from '../types'

interface SqliteStorageSessionOptions {
  databaseService: DatabaseService
  dbPool: DbPool | null
}

const SQLITE_CAPABILITIES: StorageCapabilities = {
  backend: 'sqlite',
  supportsEncryptionAtRest: true,
  supportsLocalFileLifecycle: true,
  supportsHostedConnectionLifecycle: false,
  supportsWorkerReadPool: true,
  supportsFullTextSearch: true
}

export class SqliteStorageSession implements StorageSession {
  readonly capabilities = SQLITE_CAPABILITIES
  readonly workspace: WorkspaceRef

  private readonly databaseService: DatabaseService
  private readonly dbPool: DbPool | null

  constructor(options: SqliteStorageSessionOptions) {
    this.databaseService = options.databaseService
    this.dbPool = options.dbPool

    const dbPath = this.databaseService.getPath()

    this.workspace = {
      kind: 'sqlite',
      path: dbPath,
      name: dbPath.split(/[\\/]/).pop() ?? 'varlens.db',
      encrypted: this.databaseService.isEncrypted()
    }
  }

  getDatabaseService(): DatabaseService {
    return this.databaseService
  }

  getDbPool(): DbPool | null {
    return this.dbPool
  }

  getEncryptionKey(): string | undefined {
    return this.databaseService.getEncryptionKey()
  }

  needsStartupRebuild(): boolean {
    return this.databaseService.needsStartupRebuild()
  }

  rekey(newPassword: string): void {
    this.databaseService.rekey(newPassword)
  }

  async close(): Promise<void> {
    if (this.dbPool !== null) {
      await this.dbPool.destroy()
    }

    this.databaseService.close()
  }

  async health(): Promise<StorageHealth> {
    const startedAt = Date.now()

    try {
      this.databaseService.database.prepare('SELECT 1').get()

      return {
        ok: true,
        backend: 'sqlite',
        roundTripMs: Date.now() - startedAt
      }
    } catch (error) {
      return {
        ok: false,
        backend: 'sqlite',
        message: error instanceof Error ? error.message : String(error),
        roundTripMs: Date.now() - startedAt
      }
    }
  }
}
