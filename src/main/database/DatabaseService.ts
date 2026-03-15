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

      // Analyze tables with stale statistics on connection open
      this.db.pragma('optimize=0x10002')

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

      // Initial cohort summary rebuild if tables are empty but variants exist
      try {
        const summaryCount = this.db
          .prepare('SELECT COUNT(*) as c FROM cohort_variant_summary')
          .get() as { c: number }
        const variantCount = this.db.prepare('SELECT COUNT(*) as c FROM variants').get() as {
          c: number
        }
        if (summaryCount.c === 0 && variantCount.c > 0) {
          this._cohortSummary.rebuild()
        }
      } catch {
        // Best effort — summary will be rebuilt on next import
      }

      // Clean up expired API cache entries on startup
      this.db.prepare('DELETE FROM api_cache WHERE expires_at < ?').run(Date.now())
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
      this.db.pragma('optimize')
    } catch {
      // Best-effort optimization; ignore failures to ensure the database still closes
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
