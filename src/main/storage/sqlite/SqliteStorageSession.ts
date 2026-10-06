import type { DatabaseService } from '../../database/DatabaseService'
import type { DbPool } from '../../database/DbPool'
import type { Case } from '../../../shared/types/database'
import type { StorageImportExecutor } from '../import-executor'
import type { StorageReadExecutor } from '../read-executor'
import type { StorageSession } from '../session'
import type { StorageCapabilities, StorageHealth, WorkspaceRef } from '../types'
import type { StorageWriteExecutor } from '../write-executor'
import { SqliteImportExecutor } from './SqliteImportExecutor'
import { SqliteReadExecutor } from './SqliteReadExecutor'
import { SqliteWriteExecutor } from './SqliteWriteExecutor'

interface SqliteStorageSessionOptions {
  databaseService: DatabaseService
  dbPool: DbPool | null
}

export const SQLITE_CAPABILITIES: StorageCapabilities = {
  backend: 'sqlite',
  workspace: {
    localFileLifecycle: true,
    hostedConnectionLifecycle: false,
    encryptionAtRest: true,
    migrations: true,
    healthDiagnostics: true
  },
  cases: {
    list: true,
    query: true,
    deleteOne: true,
    deleteMany: true,
    deleteAll: true,
    overview: true
  },
  imports: {
    json: true,
    vcf: true,
    multiFileVcf: true,
    bedFilters: true,
    cancellation: true
  },
  variants: {
    query: true,
    searchQuery: true,
    legacySearch: true,
    filterOptions: true,
    columnMeta: true,
    typeCounts: true,
    typesPresent: true,
    geneSymbols: true,
    panelFilters: true,
    tagFilters: true,
    commentFilters: true,
    acmgFilters: true,
    annotationFilters: true,
    inheritanceFilters: true,
    analysisGroupFilters: true,
    phasingFilters: true
  },
  workflow: {
    tags: true,
    annotations: true,
    caseComments: true,
    caseMetrics: true,
    filterPresets: true,
    panels: true,
    geneLists: true,
    regionFiles: true,
    analysisGroups: true,
    auditLog: true
  },
  cohort: {
    query: true,
    summary: true,
    rebuild: true,
    carriers: true,
    geneBurden: true,
    columnMeta: true
  },
  export: {
    variants: true,
    cohort: true,
    streaming: true
  }
}

export class SqliteStorageSession implements StorageSession {
  readonly capabilities = SQLITE_CAPABILITIES
  readonly workspace: WorkspaceRef

  private readonly databaseService: DatabaseService
  private readonly dbPool: DbPool | null
  private readonly readExecutor: StorageReadExecutor
  private readonly writeExecutor: SqliteWriteExecutor
  private readonly importExecutor: StorageImportExecutor

  constructor(options: SqliteStorageSessionOptions) {
    this.databaseService = options.databaseService
    this.dbPool = options.dbPool
    this.readExecutor = new SqliteReadExecutor(this.databaseService, this.dbPool)
    this.writeExecutor = new SqliteWriteExecutor(this.databaseService)
    this.importExecutor = new SqliteImportExecutor({
      getDatabaseService: () => this.databaseService,
      // `getSession` is a deferred closure: it is only invoked at import time
      // (after construction completes), so this self-reference is safe.
      // Required because SqliteImportExecutor.importMultiFile delegates to
      // startMultiFileImport, which calls back into the session for the
      // first-file startImport call.
      getSession: () => this
    })

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

  getReadExecutor(): StorageReadExecutor {
    return this.readExecutor
  }

  getWriteExecutor(): StorageWriteExecutor {
    return this.writeExecutor
  }

  getImportExecutor(): StorageImportExecutor {
    return this.importExecutor
  }

  async listCases(): Promise<Case[]> {
    if (this.dbPool !== null) {
      return (await this.dbPool.run({ type: 'cases:list', params: [] })) as Case[]
    }

    return this.databaseService.cases.getAllCases()
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
    // The writer thread holds a connection keyed with the old password; stop
    // it so the next write reopens with the new key.
    void this.writeExecutor.close()
  }

  async close(): Promise<void> {
    await this.writeExecutor.close()

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
