import type { Pool } from 'pg'

import { mainLogger } from '../../services/MainLogger'
import type { Case } from '../../../shared/types/database'
import { PostgresAvailableBuildsRepository } from './PostgresAvailableBuildsRepository'
import { PostgresAnalysisGroupsRepository } from './PostgresAnalysisGroupsRepository'
import { PostgresAnnotationsRepository } from './PostgresAnnotationsRepository'
import { PostgresAuditLogRepository } from './PostgresAuditLogRepository'
import { PostgresCaseLifecycleRepository } from './PostgresCaseLifecycleRepository'
import { PostgresCaseListRepository } from './PostgresCaseListRepository'
import { PostgresCaseMetadataRepository } from './PostgresCaseMetadataRepository'
import { PostgresCasesQueryRepository } from './PostgresCasesQueryRepository'
import { PostgresCohortRepository } from './PostgresCohortRepository'
import { PostgresCommentsMetricsRepository } from './PostgresCommentsMetricsRepository'
import { PostgresExportRepository } from './PostgresExportRepository'
import { PostgresFilterPresetsRepository } from './PostgresFilterPresetsRepository'
import { PostgresHealthDiagnostics } from './PostgresHealthDiagnostics'
import type { PostgresHealthDiagnosticResult } from './PostgresHealthDiagnostics'
import { PostgresImportExecutor } from './PostgresImportExecutor'
import { PostgresOverviewRepository } from './PostgresOverviewRepository'
import { PostgresPanelsRepository } from './PostgresPanelsRepository'
import { PostgresPublicAnnotationRepository } from './PostgresPublicAnnotationRepository'
import { PostgresReadExecutor } from './PostgresReadExecutor'
import { PostgresShortlistService } from './PostgresShortlistService'
import { PostgresTagsRepository } from './PostgresTagsRepository'
import { PostgresTranscriptsRepository } from './PostgresTranscriptsRepository'
import { PostgresVariantReadRepository } from './PostgresVariantReadRepository'
import type { StorageImportExecutor } from '../import-executor'
import type { StorageReadExecutor } from '../read-executor'
import { PostgresWriteExecutor } from './PostgresWriteExecutor'
import {
  buildPostgresClientConfig,
  buildPostgresConnectionLabel,
  redactPostgresConnectionUrl,
  type PostgresStorageConfig
} from '../config'
import { toPostgresClientConfigMessage } from '../../../shared/types/postgres-import-worker'
import type { StorageSession } from '../session'
import type { StorageCapabilities, StorageHealth, WorkspaceRef } from '../types'
import type { StorageWriteExecutor } from '../write-executor'
import type { PostgresMigrationResult } from './migrations/types'

interface PostgresStorageSessionOptions {
  config: PostgresStorageConfig
  pool: Pool
  migrationResult?: PostgresMigrationResult
  createCaseListRepository?: (pool: Pool, schema: string) => PostgresCaseListRepository
  publicAnnotations?: PostgresPublicAnnotationRepository
}

export const POSTGRES_CAPABILITIES: StorageCapabilities = {
  backend: 'postgres',
  workspace: {
    localFileLifecycle: false,
    hostedConnectionLifecycle: true,
    encryptionAtRest: false,
    migrations: true,
    healthDiagnostics: true
  },
  cases: {
    list: true,
    query: true,
    deleteOne: true,
    deleteMany: false,
    deleteAll: false,
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
    legacySearch: false,
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
    rebuild: false,
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

  /**
   * Public accessor for the underlying pg.Pool.
   *
   * The web variant (src/web/server.ts) needs to share this pool with
   * PostgresWebAuthService so the process opens exactly one connection
   * pool, not two. Earlier web code reached into the private field via a
   * structural cast, which would silently break under any future refactor of
   * the field. This getter makes the contract explicit and compiler-checked.
   */
  getPool(): Pool {
    return this.pool
  }

  private readonly readExecutor: StorageReadExecutor
  private readonly writeExecutor: StorageWriteExecutor
  private readonly importExecutor: StorageImportExecutor
  private readonly migrationResult: PostgresMigrationResult | undefined
  private cases: PostgresCaseListRepository | null = null

  constructor(options: PostgresStorageSessionOptions) {
    this.pool = options.pool
    this.migrationResult = options.migrationResult
    const caseMetadata = new PostgresCaseMetadataRepository(options.pool, options.config.schema)
    const tags = new PostgresTagsRepository(options.pool, options.config.schema)
    const annotations = new PostgresAnnotationsRepository(options.pool, options.config.schema)
    const commentsMetrics = new PostgresCommentsMetricsRepository(
      options.pool,
      options.config.schema
    )
    const panels = new PostgresPanelsRepository(options.pool, options.config.schema)
    const filterPresets = new PostgresFilterPresetsRepository(options.pool, options.config.schema)
    const analysisGroups = new PostgresAnalysisGroupsRepository(options.pool, options.config.schema)
    const cohort = new PostgresCohortRepository(options.pool, options.config.schema)
    const audit = new PostgresAuditLogRepository(options.pool, options.config.schema)
    const transcripts = new PostgresTranscriptsRepository(options.pool, options.config.schema)
    const variants = new PostgresVariantReadRepository(options.pool, options.config.schema)
    const shortlist = new PostgresShortlistService({
      pool: options.pool,
      schema: options.config.schema,
      filterPresets,
      variants
    })
    this.readExecutor = new PostgresReadExecutor({
      casesQuery: new PostgresCasesQueryRepository(options.pool, options.config.schema),
      availableBuilds: new PostgresAvailableBuildsRepository(options.pool, options.config.schema),
      overview: new PostgresOverviewRepository(options.pool, options.config.schema),
      export: new PostgresExportRepository(options.pool, options.config.schema),
      cohort,
      tags,
      annotations,
      commentsMetrics,
      panels,
      filterPresets,
      shortlist,
      analysisGroups,
      audit,
      transcripts,
      caseMetadata,
      variants,
      ...(options.publicAnnotations !== undefined
        ? { publicAnnotations: options.publicAnnotations }
        : {})
    })
    this.writeExecutor = new PostgresWriteExecutor(
      caseMetadata,
      new PostgresCaseLifecycleRepository(options.pool, options.config.schema),
      {
        tags,
        annotations,
        commentsMetrics,
        panels,
        filterPresets,
        analysisGroups,
        audit,
        transcripts
      }
    )
    this.importExecutor = new PostgresImportExecutor({
      schema: options.config.schema,
      // buildPostgresClientConfig always sets connectionString = config.url (a string),
      // but pg's ClientConfig types it as `string | undefined`. The assertion is safe.
      clientConfig: toPostgresClientConfigMessage(
        buildPostgresClientConfig(options.config) as import('pg').ClientConfig & {
          connectionString: string
        }
      )
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

  getWriteExecutor(): StorageWriteExecutor {
    return this.writeExecutor
  }

  getImportExecutor(): StorageImportExecutor {
    return this.importExecutor
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

  async collectDiagnostics(): Promise<PostgresHealthDiagnosticResult> {
    const schema = this.workspace.kind === 'postgres' ? this.workspace.schema : 'public'
    const diagnostics = await new PostgresHealthDiagnostics(this.pool, schema).collect()
    if (this.migrationResult === undefined) {
      return diagnostics
    }

    return {
      ...diagnostics,
      currentMigration: this.migrationResult.currentVersion
    }
  }
}
