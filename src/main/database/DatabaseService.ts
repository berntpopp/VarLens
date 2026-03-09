/**
 * DatabaseService - Core database service for Varlens
 *
 * Manages SQLite connection, schema initialization, and case CRUD operations.
 * Uses better-sqlite3-multiple-ciphers for synchronous database access with prepared statement caching.
 */

import Database from 'better-sqlite3-multiple-ciphers'
import type { Database as DatabaseType, Statement } from 'better-sqlite3-multiple-ciphers'
import { initializeSchema } from './schema'
import { runMigrations } from './migrations'
import type {
  Case,
  Variant,
  VariantFilter,
  PaginationCursor,
  PaginatedResult,
  SortItem,
  VariantAnnotation,
  CaseVariantAnnotation,
  CaseMetadata,
  CohortGroup,
  CaseHpoTerm,
  Tag,
  CaseComment,
  CommentCategory,
  MetricDefinition,
  CaseMetric,
  CaseMetricWithDefinition,
  AuditLogEntry,
  AuditActionType,
  AuditEntityType
} from './types'
import type { DatabaseOverview } from '../../shared/types/database-overview'
import type { FilterOptions } from '../../shared/types/api'
import type { TranscriptAnnotation, TranscriptInsertRow } from '../../shared/types/transcript'
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
import type { AuditQueryFilter, AuditQueryResult } from './AuditLogRepository'

/**
 * DatabaseService class
 *
 * Provides database initialization, case management, and transaction support.
 * Designed for Electron main process usage with optional path override for testing.
 */
export class DatabaseService {
  private db: DatabaseType
  private _kysely: Kysely<VarlensDatabase>
  private statementCache: Map<string, Statement>
  private dbPath: string
  private encrypted: boolean
  private cases: CaseRepository
  private transcripts: TranscriptRepository
  private annotations: AnnotationRepository
  private metadata: MetadataRepository
  private tags: TagRepository
  private variantsRepo: VariantRepository
  private overview: DatabaseOverviewService
  private auditLog: AuditLogRepository
  private geneLists: GeneListRepository

  /**
   * Create a new DatabaseService instance
   *
   * @param dbPath - Path to SQLite database file. Defaults to ':memory:' for testing.
   *                 In production, pass app.getPath('userData') + '/varlens.db'
   * @param encryptionKey - Optional encryption key. When provided, PRAGMA key is issued
   *                        as the first operation after opening the database connection.
   *                        Required for opening or creating encrypted databases.
   * @throws DatabaseError if database initialization fails
   */
  constructor(dbPath: string = ':memory:', encryptionKey?: string) {
    this.dbPath = dbPath
    this.encrypted = encryptionKey !== undefined && encryptionKey !== ''

    try {
      this.db = new Database(dbPath)
      this.statementCache = new Map()

      // CRITICAL: Encryption key must be the FIRST pragma issued
      // before any other database operations including schema init
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

      // Initialize database schema (tables, indexes, FTS5)
      initializeSchema(this.db)

      // Run version-tracked migrations for v0.4.0+ features
      runMigrations(this.db)

      // Initialize Kysely query builder (shares same connection)
      this._kysely = createKysely(this.db)

      // Initialize repositories
      this.cases = new CaseRepository(this.db, this.statementCache)
      this.transcripts = new TranscriptRepository(this.db, this.statementCache)
      this.annotations = new AnnotationRepository(this.db, this.statementCache)
      this.metadata = new MetadataRepository(this.db, this.statementCache)
      this.tags = new TagRepository(this.db, this.statementCache)
      this.variantsRepo = new VariantRepository(this.db, this.statementCache, this.cases)
      this.overview = new DatabaseOverviewService(this.db, this.statementCache)
      this.auditLog = new AuditLogRepository(this.db, this.statementCache)
      this.geneLists = new GeneListRepository(this.db, this.statementCache)

      // Clean up expired API cache entries on startup
      this.db.prepare('DELETE FROM api_cache WHERE expires_at < ?').run(Date.now())
    } catch (error) {
      throw new DatabaseError(
        `Failed to initialize database at ${dbPath}`,
        error instanceof Error ? error : undefined
      )
    }
  }

  /**
   * Execute a function within a transaction
   *
   * Implements transaction support (DB-08) with automatic rollback on error.
   * Exposed for variant batch operations and testing.
   *
   * @param fn - Function to execute within transaction
   * @returns Result of the function
   * @throws TransactionError if transaction fails
   */
  runTransaction<T>(fn: () => T): T {
    try {
      const transactionFn = this.db.transaction(fn)
      return transactionFn()
    } catch (error) {
      throw new TransactionError('Transaction failed', error instanceof Error ? error : undefined)
    }
  }

  createCase(name: string, filePath: string, fileSize: number): number {
    return this.cases.createCase(name, filePath, fileSize)
  }

  getCase(id: number): Case {
    return this.cases.getCase(id)
  }

  getCaseByName(name: string): Case {
    return this.cases.getCaseByName(name)
  }

  getAllCases(): Case[] {
    return this.cases.getAllCases()
  }

  updateCaseVariantCount(id: number, count: number): void {
    this.cases.updateCaseVariantCount(id, count)
  }

  deleteCase(id: number): void {
    this.cases.deleteCase(id)
  }

  deleteAllCases(): number {
    return this.cases.deleteAllCases()
  }

  deleteCasesBatch(ids: number[]): number {
    return this.cases.deleteCasesBatch(ids)
  }

  insertVariantsBatch(
    caseId: number,
    variants: (Omit<Variant, 'id' | 'case_id'> & { _transcripts?: TranscriptInsertRow[] })[]
  ): number {
    return this.variantsRepo.insertVariantsBatch(caseId, variants)
  }

  getVariantTranscripts(variantId: number): TranscriptAnnotation[] {
    return this.transcripts.getVariantTranscripts(variantId)
  }

  switchSelectedTranscript(variantId: number, transcriptId: string): void {
    this.transcripts.switchSelectedTranscript(variantId, transcriptId)
  }

  insertTranscriptAndSwitch(variantId: number, transcript: TranscriptInsertRow): void {
    this.transcripts.insertTranscriptAndSwitch(variantId, transcript)
  }

  getVariantCount(caseId: number): number {
    return this.variantsRepo.getVariantCount(caseId)
  }

  getVariants(
    filter: VariantFilter,
    limit: number,
    cursor?: PaginationCursor,
    sortBy?: SortItem[]
  ): PaginatedResult<Variant> {
    return this.variantsRepo.getVariants(filter, limit, cursor, sortBy)
  }

  searchVariants(caseId: number, query: string, limit: number = 50): Variant[] {
    return this.variantsRepo.searchVariants(caseId, query, limit)
  }

  getGeneSymbols(caseId: number, query: string, limit: number = 50): string[] {
    return this.variantsRepo.getGeneSymbols(caseId, query, limit)
  }

  getAllVariantsForExport(filter: VariantFilter): Variant[] {
    return this.variantsRepo.getAllVariantsForExport(filter)
  }

  getFilterOptions(caseId: number): FilterOptions {
    return this.variantsRepo.getFilterOptions(caseId)
  }

  /**
   * Clear the prepared statement cache
   *
   * Should be called before closing the database to release all prepared statements.
   */
  clearStatementCache(): void {
    this.statementCache.clear()
  }

  /**
   * Check if this database is encrypted
   *
   * @returns True if database was opened with an encryption key
   */
  isEncrypted(): boolean {
    return this.encrypted
  }

  /**
   * Get the path to the database file
   *
   * @returns Path to the database file
   */
  getPath(): string {
    return this.dbPath
  }

  /**
   * Change the encryption key for an encrypted database
   *
   * Note: This only works on already-encrypted databases.
   * Cannot encrypt a plaintext database.
   *
   * @param newPassword - New encryption password
   * @throws DatabaseError if rekey operation fails
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

  getGlobalAnnotation(
    chr: string,
    pos: number,
    ref: string,
    alt: string
  ): VariantAnnotation | null {
    return this.annotations.getGlobalAnnotation(chr, pos, ref, alt)
  }

  upsertGlobalAnnotation(
    chr: string,
    pos: number,
    ref: string,
    alt: string,
    updates: Partial<
      Pick<
        VariantAnnotation,
        'global_comment' | 'starred' | 'acmg_classification' | 'acmg_evidence'
      >
    >
  ): VariantAnnotation {
    return this.annotations.upsertGlobalAnnotation(chr, pos, ref, alt, updates)
  }

  deleteGlobalAnnotation(chr: string, pos: number, ref: string, alt: string): void {
    this.annotations.deleteGlobalAnnotation(chr, pos, ref, alt)
  }

  getPerCaseAnnotation(caseId: number, variantId: number): CaseVariantAnnotation | null {
    return this.annotations.getPerCaseAnnotation(caseId, variantId)
  }

  upsertPerCaseAnnotation(
    caseId: number,
    variantId: number,
    updates: Partial<
      Pick<
        CaseVariantAnnotation,
        'per_case_comment' | 'starred' | 'acmg_classification' | 'acmg_evidence'
      >
    >
  ): CaseVariantAnnotation {
    return this.annotations.upsertPerCaseAnnotation(caseId, variantId, updates)
  }

  deletePerCaseAnnotation(caseId: number, variantId: number): void {
    this.annotations.deletePerCaseAnnotation(caseId, variantId)
  }

  getAnnotationsForVariant(
    caseId: number,
    chr: string,
    pos: number,
    ref: string,
    alt: string
  ): { global: VariantAnnotation | null; perCase: CaseVariantAnnotation | null } {
    return this.annotations.getAnnotationsForVariant(caseId, chr, pos, ref, alt)
  }

  // Audit log delegates
  appendAuditEntry(input: {
    action_type: AuditActionType
    entity_type: AuditEntityType
    entity_key: string
    old_value: string | null
    new_value: string | null
    user_name: string | null
  }): AuditLogEntry {
    return this.auditLog.appendEntry(input)
  }

  getAuditByEntityKey(entityKey: string): AuditLogEntry[] {
    return this.auditLog.getByEntityKey(entityKey)
  }

  queryAuditLog(filter: AuditQueryFilter): AuditQueryResult {
    return this.auditLog.query(filter)
  }

  getCaseMetadata(caseId: number): CaseMetadata | null {
    return this.metadata.getCaseMetadata(caseId)
  }

  upsertCaseMetadata(
    caseId: number,
    updates: { affected_status?: string | null; sex?: string | null; notes?: string | null }
  ): CaseMetadata {
    return this.metadata.upsertCaseMetadata(caseId, updates)
  }

  listCohortGroups(): CohortGroup[] {
    return this.metadata.listCohortGroups()
  }

  createCohortGroup(name: string, description?: string | null): CohortGroup {
    return this.metadata.createCohortGroup(name, description)
  }

  updateCohortGroup(
    id: number,
    updates: { name?: string; description?: string | null }
  ): CohortGroup {
    return this.metadata.updateCohortGroup(id, updates)
  }

  deleteCohortGroup(cohortId: number): void {
    this.metadata.deleteCohortGroup(cohortId)
  }

  getCohortGroupByName(name: string): CohortGroup | null {
    return this.metadata.getCohortGroupByName(name)
  }

  getCaseCohorts(caseId: number): CohortGroup[] {
    return this.metadata.getCaseCohorts(caseId)
  }

  assignCaseCohort(caseId: number, cohortId: number): void {
    this.metadata.assignCaseCohort(caseId, cohortId)
  }

  removeCaseCohort(caseId: number, cohortId: number): void {
    this.metadata.removeCaseCohort(caseId, cohortId)
  }

  setCaseCohorts(caseId: number, cohortIds: number[]): void {
    this.metadata.setCaseCohorts(caseId, cohortIds)
  }

  getCaseHpoTerms(caseId: number): CaseHpoTerm[] {
    return this.metadata.getCaseHpoTerms(caseId)
  }

  assignCaseHpoTerm(caseId: number, hpoId: string, hpoLabel: string): CaseHpoTerm {
    return this.metadata.assignCaseHpoTerm(caseId, hpoId, hpoLabel)
  }

  removeCaseHpoTerm(caseId: number, hpoId: string): void {
    this.metadata.removeCaseHpoTerm(caseId, hpoId)
  }

  // Case Comments
  listCaseComments(caseId: number): CaseComment[] {
    return this.metadata.listCaseComments(caseId)
  }

  createCaseComment(caseId: number, category: CommentCategory, content: string): CaseComment {
    return this.metadata.createCaseComment(caseId, category, content)
  }

  updateCaseComment(commentId: number, content: string): CaseComment {
    return this.metadata.updateCaseComment(commentId, content)
  }

  deleteCaseComment(commentId: number): void {
    this.metadata.deleteCaseComment(commentId)
  }

  // Metric Definitions
  listMetricDefinitions(): MetricDefinition[] {
    return this.metadata.listMetricDefinitions()
  }

  createMetricDefinition(
    name: string,
    valueType: 'numeric' | 'text' | 'date',
    unit: string,
    category: string
  ): MetricDefinition {
    return this.metadata.createMetricDefinition(name, valueType, unit, category)
  }

  // Case Metrics
  listCaseMetrics(caseId: number): CaseMetricWithDefinition[] {
    return this.metadata.listCaseMetrics(caseId)
  }

  upsertCaseMetric(
    caseId: number,
    metricId: number,
    value: { numeric_value?: number | null; text_value?: string | null; date_value?: string | null }
  ): CaseMetric {
    return this.metadata.upsertCaseMetric(caseId, metricId, value)
  }

  deleteCaseMetric(caseId: number, metricId: number): void {
    this.metadata.deleteCaseMetric(caseId, metricId)
  }

  // Case Data Info
  getCaseDataInfo(caseId: number): import('./types').CaseDataInfo | null {
    return this.metadata.getCaseDataInfo(caseId)
  }

  upsertCaseDataInfo(
    caseId: number,
    updates: import('./types').CaseDataInfoUpdates & {
      import_file_name?: string | null
      import_file_type?: string | null
    }
  ): import('./types').CaseDataInfo {
    return this.metadata.upsertCaseDataInfo(caseId, updates)
  }

  // Case External IDs
  listCaseExternalIds(caseId: number): import('./types').CaseExternalId[] {
    return this.metadata.listCaseExternalIds(caseId)
  }

  upsertCaseExternalId(
    caseId: number,
    idType: string,
    idValue: string
  ): import('./types').CaseExternalId {
    return this.metadata.upsertCaseExternalId(caseId, idType, idValue)
  }

  deleteCaseExternalId(caseId: number, idType: string): void {
    this.metadata.deleteCaseExternalId(caseId, idType)
  }

  getDistinctPlatforms(): string[] {
    return this.metadata.getDistinctPlatforms()
  }

  getDistinctExternalIdTypes(): string[] {
    return this.metadata.getDistinctExternalIdTypes()
  }

  // Gene Lists
  listGeneLists(): import('./types').GeneListWithCount[] {
    return this.geneLists.listGeneLists()
  }

  createGeneList(name: string, description?: string | null): import('./types').GeneList {
    return this.geneLists.createGeneList(name, description)
  }

  deleteGeneList(id: number): void {
    this.geneLists.deleteGeneList(id)
  }

  getGeneListGenes(listId: number): string[] {
    return this.geneLists.getGeneListGenes(listId)
  }

  setGeneListGenes(listId: number, genes: string[]): void {
    this.geneLists.setGeneListGenes(listId, genes)
  }

  // Region Files
  listRegionFiles(): import('./types').RegionFile[] {
    return this.geneLists.listRegionFiles()
  }

  createRegionFile(name: string, description: string | null): import('./types').RegionFile {
    return this.geneLists.createRegionFile(name, description)
  }

  deleteRegionFile(id: number): void {
    this.geneLists.deleteRegionFile(id)
  }

  importBedEntries(
    fileId: number,
    entries: Array<{ chr: string; start: number; end: number; label?: string }>
  ): import('./types').RegionFile {
    return this.geneLists.importBedEntries(fileId, entries)
  }

  listTags(): Tag[] {
    return this.tags.listTags()
  }

  createTag(name: string, color: string): Tag {
    return this.tags.createTag(name, color)
  }

  updateTag(id: number, updates: { name?: string; color?: string }): Tag {
    return this.tags.updateTag(id, updates)
  }

  deleteTag(id: number): void {
    this.tags.deleteTag(id)
  }

  getTag(id: number): Tag | null {
    return this.tags.getTag(id)
  }

  getTagUsageCount(tagId: number): number {
    return this.tags.getTagUsageCount(tagId)
  }

  getVariantTags(caseId: number, variantId: number): Tag[] {
    return this.tags.getVariantTags(caseId, variantId)
  }

  assignVariantTag(caseId: number, variantId: number, tagId: number): void {
    this.tags.assignVariantTag(caseId, variantId, tagId)
  }

  removeVariantTag(caseId: number, variantId: number, tagId: number): void {
    this.tags.removeVariantTag(caseId, variantId, tagId)
  }

  setVariantTags(caseId: number, variantId: number, tagIds: number[]): void {
    this.tags.setVariantTags(caseId, variantId, tagIds)
  }

  getDatabaseOverview(): DatabaseOverview {
    return this.overview.getDatabaseOverview()
  }

  /**
   * Close the database connection
   *
   * Should be called when the application is shutting down.
   */
  close(): void {
    this.clearStatementCache()
    // Destroy Kysely instance (sync with better-sqlite3 dialect)
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
   * Get the underlying database instance
   *
   * Exposed for testing purposes only. Use with caution.
   */
  get database(): DatabaseType {
    return this.db
  }

  /**
   * Get the Kysely query builder instance
   *
   * Returns a typed Kysely instance sharing the same underlying connection.
   * Note: All Kysely operations return Promises (even with sync better-sqlite3).
   */
  get kysely(): Kysely<VarlensDatabase> {
    return this._kysely
  }
}
