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
import { createKysely } from './kysely'
import type { Kysely } from 'kysely'
import type { VarlensDatabase } from '../../shared/types/database-schema'
import { CaseRepository } from './CaseRepository'
import { TranscriptRepository } from './TranscriptRepository'
import { AnnotationRepository } from './AnnotationRepository'
import { MetadataRepository } from './MetadataRepository'
import { TagRepository } from './TagRepository'
import { VariantRepository } from './VariantRepository'
import { DatabaseOverviewService } from './DatabaseOverviewService'
import { AuditLogRepository } from './AuditLogRepository'
import { GeneListRepository } from './GeneListRepository'
import { AuthService } from '../services/auth'
import { CohortSummaryService } from './CohortSummaryService'
import { FilterPresetRepository } from './FilterPresetRepository'

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

  // Repositories — accessed via public getters
  private _cases: CaseRepository
  private _transcripts: TranscriptRepository
  private _annotations: AnnotationRepository
  private _metadata: MetadataRepository
  private _tags: TagRepository
  private _variants: VariantRepository
  private _overview: DatabaseOverviewService
  private _auditLog: AuditLogRepository
  private _geneLists: GeneListRepository
  private _auth: AuthService
  private _cohortSummary: CohortSummaryService
  private _filterPresets: FilterPresetRepository
  private _currentUser: { id: number; username: string; role: string } | null = null

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

      // Initialize database schema (tables, indexes, FTS5)
      initializeSchema(this.db)

      // Run version-tracked migrations for v0.4.0+ features
      runMigrations(this.db)

      // Initialize Kysely query builder (shares same connection)
      this._kysely = createKysely(this.db)

      // Initialize repositories
      this._cases = new CaseRepository(this.db, this._kysely)
      this._transcripts = new TranscriptRepository(this.db, this._kysely)
      this._annotations = new AnnotationRepository(this.db, this._kysely)
      this._metadata = new MetadataRepository(this.db, this._kysely)
      this._tags = new TagRepository(this.db, this._kysely)
      this._variants = new VariantRepository(this.db, this._kysely, this._cases)
      this._overview = new DatabaseOverviewService(this.db, this._kysely)
      this._auditLog = new AuditLogRepository(this.db, this._kysely)
      this._geneLists = new GeneListRepository(this.db, this._kysely)
      this._auth = new AuthService(this.db)
      this._cohortSummary = new CohortSummaryService(this.db)
      this._filterPresets = new FilterPresetRepository(this.db, this._kysely)

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
    return this._cases
  }

  get variants(): VariantRepository {
    return this._variants
  }

  get transcripts(): TranscriptRepository {
    return this._transcripts
  }

  get annotations(): AnnotationRepository {
    return this._annotations
  }

  get metadata(): MetadataRepository {
    return this._metadata
  }

  get tags(): TagRepository {
    return this._tags
  }

  get overview(): DatabaseOverviewService {
    return this._overview
  }

  get auditLog(): AuditLogRepository {
    return this._auditLog
  }

  get geneLists(): GeneListRepository {
    return this._geneLists
  }

  get auth(): AuthService {
    return this._auth
  }

  get cohortSummary(): CohortSummaryService {
    return this._cohortSummary
  }

  get filterPresets(): FilterPresetRepository {
    return this._filterPresets
  }

  get user(): { id: number; username: string; role: string } | null {
    return this._currentUser
  }

  setCurrentUser(user: { id: number; username: string; role: string } | null): void {
    this._currentUser = user
  }

  isAccountsEnabled(): boolean {
    return this._auth.isAccountsEnabled()
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
      } catch {
        // Best effort
      }
    })
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
    } catch {
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
    this._kysely.destroy().catch(() => {})
    try {
      // Cap ANALYZE sampling so optimize finishes quickly even on large tables
      this.db.pragma(`analysis_limit = ${DATABASE_CONFIG.ANALYSIS_LIMIT}`)
      // Analyse tables whose statistics have gone stale since the connection opened
      this.db.pragma('optimize')
      // Merge the WAL back into the main DB file so the next open is fast
      this.db.pragma('wal_checkpoint(TRUNCATE)')
    } catch {
      // Best-effort; ignore failures to ensure the database still closes
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
