/**
 * DatabaseService - Core database service for Varlens
 *
 * Manages SQLite connection, schema initialization, and exposes typed repositories.
 * Uses better-sqlite3-multiple-ciphers for synchronous database access.
 * Repositories use Kysely compile+execute helpers (`execAll`, `execFirst`, `execRun`)
 * for type-safe query building.
 */

import Database from 'better-sqlite3-multiple-ciphers'
import type { Database as DatabaseType } from 'better-sqlite3-multiple-ciphers'
import { initializeSchema } from './schema'
import { runMigrations } from './migrations'
import { DatabaseError, TransactionError } from './errors'
import { DATABASE_CONFIG } from '../../shared/config'
import { mainLogger } from '../services/MainLogger'
import type { Kysely } from 'kysely'
import type { VarlensDatabase } from '../../shared/types/database-schema'
import { createRepositories, type Repositories } from './createRepositories'
import type { CaseRepository } from './CaseRepository'
import type { TranscriptRepository } from './TranscriptRepository'
import type { AnnotationRepository } from './AnnotationRepository'
import type { MetadataRepository } from './MetadataRepository'
import type { TagRepository } from './TagRepository'
import type { VariantRepository } from './VariantRepository'
import type { DatabaseOverviewService } from './DatabaseOverviewService'
import type { AuditLogRepository } from './AuditLogRepository'
import type { GeneListRepository } from './GeneListRepository'
import type { AuthService } from '../services/auth'
import type { CohortSummaryService } from './CohortSummaryService'
import type { CohortService } from './cohort'
import type { FilterPresetRepository } from './FilterPresetRepository'
import type { PanelRepository } from './PanelRepository'
import type { AnalysisGroupRepository } from './AnalysisGroupRepository'

/**
 * DatabaseService class
 *
 * Provides database initialization, repository access, and transaction support.
 * Designed for Electron main process usage with optional path override for testing.
 */
export class DatabaseService {
  private db: DatabaseType
  private _kysely: Kysely<VarlensDatabase>
  private dbPath: string
  private encrypted: boolean
  private _encryptionKey?: string

  // Repositories — created via shared factory, accessed via public getters
  private _repos: Repositories
  private _currentUser: { id: number; username: string; role: string } | null = null
  private _cacheCleanupTimer: ReturnType<typeof setInterval> | null = null

  /**
   * Create a new DatabaseService instance
   *
   * @param dbPath - Path to SQLite database file. Defaults to ':memory:' for testing.
   * @param encryptionKey - Optional encryption key for encrypted databases.
   * @throws DatabaseError if database initialization fails
   */
  constructor(dbPath: string = ':memory:', encryptionKey?: string) {
    this.dbPath = dbPath
    this.encrypted = encryptionKey !== undefined && encryptionKey !== ''
    this._encryptionKey = encryptionKey

    try {
      this.db = new Database(dbPath)

      // CRITICAL: Encryption key must be the FIRST pragma issued
      if (this.encrypted) {
        const safeKey = encryptionKey!.split("'").join("''")
        this.db.pragma(`key='${safeKey}'`)
      }

      // Set page size for new databases (no-op on existing ones with data).
      // Must be issued BEFORE journal_mode = WAL and any table creation.
      this.db.pragma(`page_size = ${DATABASE_CONFIG.PAGE_SIZE}`)

      // Enable WAL mode for better concurrent read performance
      this.db.pragma('journal_mode = WAL')

      // Enable foreign key constraints
      this.db.pragma('foreign_keys = ON')

      // Performance PRAGMAs
      this.db.pragma('synchronous = NORMAL')
      this.db.pragma(`busy_timeout = ${DATABASE_CONFIG.BUSY_TIMEOUT_MS}`)
      this.db.pragma(`cache_size = ${DATABASE_CONFIG.CACHE_SIZE_KB}`)
      this.db.pragma('temp_store = MEMORY')
      this.db.pragma(`mmap_size = ${DATABASE_CONFIG.MMAP_SIZE_BYTES}`)
      this.db.pragma(`analysis_limit = ${DATABASE_CONFIG.ANALYSIS_LIMIT}`)
      this.db.pragma('journal_size_limit = 6144000') // 6 MB — prevents WAL bloat

      // Initialize database schema (tables, indexes, FTS5)
      initializeSchema(this.db)

      // Run version-tracked migrations for v0.4.0+ features
      runMigrations(this.db)

      // Initialize repositories via shared factory (also creates Kysely instance)
      this._repos = createRepositories(this.db)
      this._kysely = this._repos.kysely

      // Defer heavy housekeeping to after the constructor returns so the
      // window can render while these run on the next event-loop tick.
      this._deferredInit()
    } catch (error) {
      throw new DatabaseError(
        `Failed to initialize database at ${dbPath}`,
        error instanceof Error ? error : undefined
      )
    }
  }

  // ── Repository getters ──────────────────────────────────────

  get cases(): CaseRepository {
    return this._repos.cases
  }

  get variants(): VariantRepository {
    return this._repos.variants
  }

  get transcripts(): TranscriptRepository {
    return this._repos.transcripts
  }

  get annotations(): AnnotationRepository {
    return this._repos.annotations
  }

  get metadata(): MetadataRepository {
    return this._repos.metadata
  }

  get tags(): TagRepository {
    return this._repos.tags
  }

  get overview(): DatabaseOverviewService {
    return this._repos.overview
  }

  get auditLog(): AuditLogRepository {
    return this._repos.auditLog
  }

  get geneLists(): GeneListRepository {
    return this._repos.geneLists
  }

  get auth(): AuthService {
    return this._repos.auth
  }

  get cohort(): CohortService {
    return this._repos.cohort
  }

  get cohortSummary(): CohortSummaryService {
    return this._repos.cohortSummary
  }

  get filterPresets(): FilterPresetRepository {
    return this._repos.filterPresets
  }

  get panels(): PanelRepository {
    return this._repos.panels
  }

  get analysisGroups(): AnalysisGroupRepository {
    return this._repos.analysisGroups
  }

  get user(): { id: number; username: string; role: string } | null {
    return this._currentUser
  }

  setCurrentUser(user: { id: number; username: string; role: string } | null): void {
    this._currentUser = user
  }

  isAccountsEnabled(): boolean {
    return this._repos.auth.isAccountsEnabled()
  }

  // ── Deferred initialisation ────────────────────────────────

  /**
   * Run non-critical housekeeping after the constructor returns so that
   * the Electron window can render without waiting for these operations.
   *
   * Uses process.nextTick so the work executes on the very next event-loop
   * turn — still on the main thread (better-sqlite3 is synchronous) but
   * after the BrowserWindow has had a chance to show.
   *
   * NOTE: Cohort summary rebuild is no longer performed here. It is
   * handled asynchronously via a worker thread after IPC handlers are
   * registered (see cohort.ts `triggerStartupRebuildIfNeeded`).
   */
  private _deferredInit(): void {
    process.nextTick(() => {
      try {
        // Clean up expired API cache entries
        this.db.prepare('DELETE FROM api_cache WHERE expires_at < ?').run(Date.now())
      } catch (e) {
        mainLogger.warn(
          'Failed to clean up expired API cache entries: ' +
            (e instanceof Error ? e.message : String(e)),
          'database'
        )
      }
    })

    // Schedule periodic cache cleanup to prevent unbounded growth during long sessions
    this._cacheCleanupTimer = setInterval(() => {
      try {
        this.db.prepare('DELETE FROM api_cache WHERE expires_at < ?').run(Date.now())
      } catch (e) {
        mainLogger.warn(
          'Periodic API cache cleanup failed (DB may be closed): ' +
            (e instanceof Error ? e.message : String(e)),
          'database'
        )
      }
    }, DATABASE_CONFIG.CACHE_CLEANUP_INTERVAL_MS)
    // Prevent the timer from keeping the Node.js event loop alive during quit
    this._cacheCleanupTimer.unref()
  }

  /**
   * Check whether the cohort summary tables need a startup rebuild.
   *
   * Returns true when the summary is empty but variants exist —
   * i.e., the summary was never built or was cleared.
   * Uses lightweight EXISTS queries instead of COUNT(*).
   */
  needsStartupRebuild(): boolean {
    try {
      const summaryRow = this.db.prepare('SELECT 1 FROM cohort_variant_summary LIMIT 1').get()
      const variantRow = this.db.prepare('SELECT 1 FROM variants LIMIT 1').get()
      return summaryRow === undefined && variantRow !== undefined
    } catch (e) {
      mainLogger.warn(
        'Failed to check startup rebuild status: ' + (e instanceof Error ? e.message : String(e)),
        'database'
      )
      return false
    }
  }

  // ── Utility methods ─────────────────────────────────────────

  /**
   * Execute a function within a transaction
   */
  runTransaction<T>(fn: () => T): T {
    try {
      const transactionFn = this.db.transaction(fn)
      return transactionFn()
    } catch (error) {
      throw new TransactionError('Transaction failed', error instanceof Error ? error : undefined)
    }
  }

  /**
   * Check if this database is encrypted
   */
  isEncrypted(): boolean {
    return this.encrypted
  }

  /**
   * Get the path to the database file
   */
  getPath(): string {
    return this.dbPath
  }

  /**
   * Get the encryption key (for worker thread usage)
   */
  getEncryptionKey(): string | undefined {
    return this._encryptionKey
  }

  /**
   * Change the encryption key for an encrypted database
   */
  rekey(newPassword: string): void {
    try {
      const safePassword = newPassword.split("'").join("''")
      this.db.pragma(`rekey='${safePassword}'`)
    } catch (error) {
      throw new DatabaseError(
        'Failed to change database encryption key',
        error instanceof Error ? error : undefined
      )
    }
  }

  /**
   * Close the database connection
   */
  close(): void {
    if (this._cacheCleanupTimer !== null) {
      clearInterval(this._cacheCleanupTimer)
      this._cacheCleanupTimer = null
    }
    this._kysely.destroy().catch((e) => {
      mainLogger.warn(
        `Kysely destroy failed during close: ${e instanceof Error ? e.message : String(e)}`,
        'database'
      )
    })
    try {
      // Cap ANALYZE sampling so optimize finishes quickly even on large tables
      this.db.pragma(`analysis_limit = ${DATABASE_CONFIG.ANALYSIS_LIMIT}`)
      // Analyse tables whose statistics have gone stale since the connection opened
      this.db.pragma('optimize')
      // Merge the WAL back into the main DB file so the next open is fast
      this.db.pragma('wal_checkpoint(TRUNCATE)')
    } catch (e) {
      mainLogger.warn(
        'Failed to optimize/checkpoint on close: ' + (e instanceof Error ? e.message : String(e)),
        'database'
      )
    } finally {
      this.db.close()
    }
  }

  /**
   * Get the underlying database instance (for testing/advanced use)
   */
  get database(): DatabaseType {
    return this.db
  }

  /**
   * Get the Kysely query builder instance
   */
  get kysely(): Kysely<VarlensDatabase> {
    return this._kysely
  }
}
