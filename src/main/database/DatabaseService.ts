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
  CaseHpoTerm
} from './types'
import { DatabaseError, NotFoundError, UniqueConstraintError, TransactionError } from './errors'

/**
 * Batch size for bulk insert operations.
 * Using 5000 rows per batch for optimal SQLite performance.
 */
const BATCH_SIZE = 5000

/**
 * Columns that support sorting.
 * Maps column keys to their SQL column names.
 */
const SORTABLE_COLUMNS: Record<string, string> = {
  chr: 'chr',
  pos: 'pos',
  gene_symbol: 'gene_symbol',
  consequence: 'consequence',
  gnomad_af: 'gnomad_af',
  cadd: 'cadd',
  clinvar: 'clinvar'
}

/**
 * DatabaseService class
 *
 * Provides database initialization, case management, and transaction support.
 * Designed for Electron main process usage with optional path override for testing.
 */
export class DatabaseService {
  private db: DatabaseType
  private statementCache: Map<string, Statement>
  private dbPath: string
  private encrypted: boolean

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
        this.db.pragma(`key='${encryptionKey}'`)
      }

      // Enable WAL mode for better concurrent read performance
      this.db.pragma('journal_mode = WAL')

      // Enable foreign key constraints
      this.db.pragma('foreign_keys = ON')

      // Initialize database schema (tables, indexes, FTS5)
      initializeSchema(this.db)

      // Run version-tracked migrations for v0.4.0+ features
      runMigrations(this.db)
    } catch (error) {
      throw new DatabaseError(
        `Failed to initialize database at ${dbPath}`,
        error instanceof Error ? error : undefined
      )
    }
  }

  /**
   * Get or create a cached prepared statement
   *
   * Implements prepared statement caching (DB-07) for improved performance.
   * Statements are cached by SQL string and reused across calls.
   *
   * @param sql - SQL statement to prepare
   * @returns Cached or newly prepared statement
   */
  private stmt(sql: string): Statement {
    let statement = this.statementCache.get(sql)
    if (statement === undefined) {
      statement = this.db.prepare(sql)
      this.statementCache.set(sql, statement)
    }
    return statement
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

  /**
   * Create a new case
   *
   * @param name - Unique case name
   * @param filePath - Original import file path
   * @param fileSize - File size in bytes
   * @returns ID of the created case
   * @throws UniqueConstraintError if case name already exists
   * @throws DatabaseError if insert fails
   */
  createCase(name: string, filePath: string, fileSize: number): number {
    try {
      const result = this.stmt(
        'INSERT INTO cases (name, file_path, file_size, variant_count, created_at) VALUES (?, ?, ?, 0, ?)'
      ).run(name, filePath, fileSize, Date.now())

      return Number(result.lastInsertRowid)
    } catch (error) {
      // Check for unique constraint violation
      if (error instanceof Error && error.message.includes('UNIQUE constraint failed') === true) {
        throw new UniqueConstraintError('name', name)
      }
      throw new DatabaseError(
        `Failed to create case: ${name}`,
        error instanceof Error ? error : undefined
      )
    }
  }

  /**
   * Get a case by ID
   *
   * @param id - Case ID
   * @returns Case object
   * @throws NotFoundError if case does not exist
   */
  getCase(id: number): Case {
    const result = this.stmt('SELECT * FROM cases WHERE id = ?').get(id) as Case | undefined

    if (!result) {
      throw new NotFoundError('Case', id)
    }

    return result
  }

  /**
   * Get a case by name
   *
   * @param name - Case name
   * @returns Case object
   * @throws NotFoundError if case does not exist
   */
  getCaseByName(name: string): Case {
    const result = this.stmt('SELECT * FROM cases WHERE name = ?').get(name) as Case | undefined

    if (!result) {
      throw new NotFoundError('Case', name)
    }

    return result
  }

  /**
   * Get all cases ordered by creation date (newest first)
   *
   * @returns Array of all cases
   */
  getAllCases(): Case[] {
    return this.stmt('SELECT * FROM cases ORDER BY created_at DESC').all() as Case[]
  }

  /**
   * Update the variant count for a case
   *
   * @param id - Case ID
   * @param count - New variant count
   * @throws NotFoundError if case does not exist
   */
  updateCaseVariantCount(id: number, count: number): void {
    const result = this.stmt('UPDATE cases SET variant_count = ? WHERE id = ?').run(count, id)

    if (result.changes === 0) {
      throw new NotFoundError('Case', id)
    }
  }

  /**
   * Delete a case by ID
   *
   * Note: ON DELETE CASCADE in schema handles automatic variant deletion.
   *
   * @param id - Case ID
   * @throws NotFoundError if case does not exist
   */
  deleteCase(id: number): void {
    const result = this.stmt('DELETE FROM cases WHERE id = ?').run(id)

    if (result.changes === 0) {
      throw new NotFoundError('Case', id)
    }
  }

  /**
   * Insert variants in batches within transactions (DB-04)
   *
   * Processes variants in batches of BATCH_SIZE for optimal SQLite performance.
   * Each batch is wrapped in a transaction. Updates case variant_count after completion.
   *
   * @param caseId - ID of the case to insert variants for
   * @param variants - Array of variant data (without id and case_id)
   * @returns Total number of variants inserted
   * @throws NotFoundError if case does not exist
   */
  insertVariantsBatch(caseId: number, variants: Omit<Variant, 'id' | 'case_id'>[]): number {
    // Verify case exists (throws NotFoundError if not)
    this.getCase(caseId)

    const insert = this.stmt(`
      INSERT INTO variants (case_id, chr, pos, ref, alt, gene_symbol, omim_mim_number, consequence, gnomad_af, cadd, clinvar, gt_num, func, qual, hpo_sim_score, transcript, cdna, aa_change, hpo_match, moi)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    // Log first variant for debugging
    if (variants.length > 0) {
      const v = variants[0]
      console.log('DEBUG: First variant keys:', Object.keys(v))
      console.log('DEBUG: First variant values:', JSON.stringify(v, null, 2))
      console.log('DEBUG: Parameter count expected: 20')
      const params = [
        caseId,
        v.chr,
        v.pos,
        v.ref,
        v.alt,
        v.gene_symbol,
        v.omim_mim_number,
        v.consequence,
        v.gnomad_af,
        v.cadd,
        v.clinvar,
        v.gt_num,
        v.func,
        v.qual,
        v.hpo_sim_score,
        v.transcript,
        v.cdna,
        v.aa_change,
        v.hpo_match,
        v.moi
      ]
      console.log('DEBUG: Actual parameter count:', params.length)
      console.log(
        'DEBUG: Parameter types:',
        params.map((p) => (Array.isArray(p) === true ? 'ARRAY!' : typeof p))
      )
    }

    const insertBatch = this.db.transaction((batch: Omit<Variant, 'id' | 'case_id'>[]) => {
      for (const v of batch) {
        insert.run(
          caseId,
          v.chr,
          v.pos,
          v.ref,
          v.alt,
          v.gene_symbol,
          v.omim_mim_number,
          v.consequence,
          v.gnomad_af,
          v.cadd,
          v.clinvar,
          v.gt_num,
          v.func,
          v.qual,
          v.hpo_sim_score,
          v.transcript,
          v.cdna,
          v.aa_change,
          v.hpo_match,
          v.moi
        )
      }
    })

    for (let i = 0; i < variants.length; i += BATCH_SIZE) {
      const batch = variants.slice(i, i + BATCH_SIZE)
      insertBatch(batch)
    }

    this.updateCaseVariantCount(caseId, variants.length)
    return variants.length
  }

  /**
   * Get the count of variants for a case
   *
   * @param caseId - ID of the case
   * @returns Number of variants
   */
  getVariantCount(caseId: number): number {
    const result = this.stmt('SELECT COUNT(*) as count FROM variants WHERE case_id = ?').get(
      caseId
    ) as { count: number }
    return result.count
  }

  /**
   * Build ORDER BY clause from sort items
   *
   * Handles NULL values per SQL standard:
   * - ASC: NULLS LAST (non-null values first, then nulls)
   * - DESC: NULLS FIRST (nulls first, then non-null values descending)
   *
   * Always appends id as tiebreaker for stable pagination.
   *
   * @param sortBy - Array of sort items (empty = default pos, id sort)
   * @returns SQL ORDER BY clause without 'ORDER BY' prefix
   */
  private buildSortClause(sortBy?: SortItem[]): string {
    if (!sortBy || sortBy.length === 0) {
      // Default sort: pos ASC, id ASC
      return 'pos ASC NULLS LAST, id ASC'
    }

    const clauses: string[] = []

    for (const sort of sortBy) {
      const sqlColumn = SORTABLE_COLUMNS[sort.key]
      if (sqlColumn === undefined) {
        // Skip invalid column names (security: prevent SQL injection)
        continue
      }

      const direction = sort.order === 'desc' ? 'DESC' : 'ASC'
      const nulls = sort.order === 'desc' ? 'NULLS FIRST' : 'NULLS LAST'
      clauses.push(`${sqlColumn} ${direction} ${nulls}`)
    }

    // If all columns were invalid, use default
    if (clauses.length === 0) {
      return 'pos ASC NULLS LAST, id ASC'
    }

    // Always add id as final tiebreaker for stable pagination
    if (clauses.some((c) => c.startsWith('id ')) === false) {
      clauses.push('id ASC')
    }

    return clauses.join(', ')
  }

  /**
   * Build a WHERE condition for a general search query.
   *
   * Supports boolean operators (AND/OR/NOT) and detects query type per token:
   * - Variant key (chr:pos:ref:alt) → exact match on all four columns
   * - Genomic position (chr:pos) → direct column match
   * - HGVS notation (c./p.) → LIKE on cdna/aa_change columns
   * - Default → FTS5 full-text search on gene_symbol/consequence
   */
  private buildSearchCondition(query: string, params: (string | number | null)[]): string {
    const term = query.trim()

    // Check for boolean operators
    const hasBooleanOps = /\b(AND|OR|NOT)\b/.test(term)

    if (!hasBooleanOps) {
      return this.buildSingleSearchToken(term, params)
    }

    // Split on boolean operators, preserving them as tokens
    const parts = term
      .split(/\b(AND|OR|NOT)\b/)
      .map((p) => p.trim())
      .filter((p) => p !== '')

    const sqlParts: string[] = []
    for (const part of parts) {
      if (part === 'AND') {
        sqlParts.push('AND')
      } else if (part === 'OR') {
        sqlParts.push('OR')
      } else if (part === 'NOT') {
        sqlParts.push('AND NOT')
      } else {
        sqlParts.push(this.buildSingleSearchToken(part, params))
      }
    }

    return `(${sqlParts.join(' ')})`
  }

  /**
   * Build a WHERE fragment for a single search token (no boolean operators).
   */
  private buildSingleSearchToken(token: string, params: (string | number | null)[]): string {
    // HGVS notation: starts with c. or p.
    const hgvsPattern = /^[cp]\./
    if (hgvsPattern.test(token)) {
      const searchPattern = `%${token}%`
      params.push(searchPattern, searchPattern)
      return '(cdna LIKE ? OR aa_change LIKE ?)'
    }

    // Default: FTS5 full-text search (gene symbol, consequence, OMIM)
    const ftsQuery = `"${token.replace(/"/g, '""')}"*`
    params.push(ftsQuery)
    return 'id IN (SELECT rowid FROM variants_fts WHERE variants_fts MATCH ?)'
  }

  /**
   * Build cursor condition for keyset pagination with dynamic sort
   *
   * For cursor-based pagination to work with any sort column:
   * - ASC: (sort_col > cursor_val) OR (sort_col = cursor_val AND id > cursor_id)
   * - DESC: (sort_col < cursor_val) OR (sort_col = cursor_val AND id > cursor_id)
   * - NULL handling: IS NULL comes after/before non-null based on direction
   *
   * @param cursor - Current pagination cursor
   * @param sortBy - Sort configuration (first item determines cursor column)
   * @returns Object with condition SQL and params array
   */
  private buildCursorCondition(
    cursor: PaginationCursor,
    sortBy?: SortItem[]
  ): { condition: string; params: (string | number | null)[] } {
    const sortItem = sortBy?.[0]
    const sortKey = sortItem?.key ?? 'pos'
    const sortDirection = sortItem?.order ?? 'asc'
    const sqlColumn = SORTABLE_COLUMNS[sortKey] ?? 'pos'

    // Validate cursor matches expected sort
    if (cursor.sort_key !== sortKey) {
      // Cursor was built with different sort - should start fresh
      // Return impossible condition that matches nothing
      return { condition: '1 = 0', params: [] }
    }

    const params: (string | number | null)[] = []
    let condition: string

    if (cursor.sort_value === null) {
      // Cursor is at a NULL value
      if (sortDirection === 'asc') {
        // ASC NULLS LAST: We're in the NULL section at the end
        // Only get NULLs with higher id
        condition = `(${sqlColumn} IS NULL AND id > ?)`
        params.push(cursor.id)
      } else {
        // DESC NULLS FIRST: We're in the NULL section at the beginning
        // Get NULLs with higher id, OR non-null values
        condition = `(${sqlColumn} IS NULL AND id > ?) OR (${sqlColumn} IS NOT NULL)`
        params.push(cursor.id)
      }
    } else {
      // Cursor has a non-null value
      const compareOp = sortDirection === 'desc' ? '<' : '>'

      if (sortDirection === 'asc') {
        // ASC NULLS LAST: value > cursor OR (value = cursor AND id > cursor_id) OR value IS NULL
        condition = `(${sqlColumn} ${compareOp} ? OR (${sqlColumn} = ? AND id > ?) OR ${sqlColumn} IS NULL)`
        params.push(cursor.sort_value, cursor.sort_value, cursor.id)
      } else {
        // DESC NULLS FIRST: value < cursor OR (value = cursor AND id > cursor_id)
        condition = `(${sqlColumn} ${compareOp} ? OR (${sqlColumn} = ? AND id > ?))`
        params.push(cursor.sort_value, cursor.sort_value, cursor.id)
      }
    }

    return { condition, params }
  }

  /**
   * Get paginated variants with filtering (DB-05, DB-06)
   *
   * Supports cursor-based pagination with filters for gene_symbol, consequence,
   * gnomAD AF, and CADD score. Also supports dynamic sorting.
   *
   * @param filter - Filter criteria including case_id (required)
   * @param limit - Maximum number of results to return
   * @param cursor - Optional cursor for pagination
   * @param sortBy - Optional sort specification (defaults to pos ASC)
   * @returns Paginated result with variants, cursor, and total count
   */
  getVariants(
    filter: VariantFilter,
    limit: number,
    cursor?: PaginationCursor,
    sortBy?: SortItem[]
  ): PaginatedResult<Variant> {
    // Build dynamic WHERE clause
    const conditions: string[] = ['case_id = ?']
    const params: (string | number | null)[] = [filter.case_id]

    if (filter.gene_symbol !== undefined && filter.gene_symbol !== '') {
      conditions.push('gene_symbol LIKE ?')
      params.push(`%${filter.gene_symbol}%`)
    }

    // Handle multi-select consequences (OR logic)
    if (filter.consequences !== undefined && filter.consequences.length > 0) {
      const placeholders = filter.consequences.map(() => '?').join(', ')
      conditions.push(`consequence IN (${placeholders})`)
      params.push(...filter.consequences)
    } else if (filter.consequence !== undefined && filter.consequence !== '') {
      // Backwards compatibility for single consequence
      conditions.push('consequence = ?')
      params.push(filter.consequence)
    }

    // Handle multi-select funcs (OR logic)
    if (filter.funcs !== undefined && filter.funcs.length > 0) {
      const placeholders = filter.funcs.map(() => '?').join(', ')
      conditions.push(`func IN (${placeholders})`)
      params.push(...filter.funcs)
    }

    // Handle multi-select clinvars (OR logic)
    if (filter.clinvars !== undefined && filter.clinvars.length > 0) {
      const placeholders = filter.clinvars.map(() => '?').join(', ')
      conditions.push(`clinvar IN (${placeholders})`)
      params.push(...filter.clinvars)
    }

    // Include NULL gnomAD AF (unknown could be rare) OR values <= threshold
    if (filter.gnomad_af_max !== undefined) {
      conditions.push('(gnomad_af IS NULL OR gnomad_af <= ?)')
      params.push(filter.gnomad_af_max)
    }

    // Exclude NULL CADD when filtering by minimum - only show variants with known CADD >= threshold
    if (filter.cadd_min !== undefined) {
      conditions.push('cadd >= ?')
      params.push(filter.cadd_min)
    }

    // General search query (hybrid: position, HGVS, or FTS5)
    if (filter.search_query != null && filter.search_query !== '') {
      const searchCondition = this.buildSearchCondition(filter.search_query, params)
      conditions.push(searchCondition)
    }

    // Exact variant coordinate filters (for cohort → case navigation)
    if (filter.chr != null && filter.chr !== '') {
      conditions.push('chr = ?')
      params.push(filter.chr)
    }
    if (filter.pos != null) {
      conditions.push('pos = ?')
      params.push(filter.pos)
    }
    if (filter.ref != null && filter.ref !== '') {
      conditions.push('ref = ?')
      params.push(filter.ref)
    }
    if (filter.alt != null && filter.alt !== '') {
      conditions.push('alt = ?')
      params.push(filter.alt)
    }

    // Build ORDER BY clause
    const orderByClause = this.buildSortClause(sortBy)

    // Get primary sort key for cursor
    const primarySortKey = sortBy?.[0]?.key ?? 'pos'

    // Execute count query (without cursor)
    const countWhereClause = conditions.join(' AND ')
    const countSql = `SELECT COUNT(*) as count FROM variants WHERE ${countWhereClause}`
    const countResult = this.db.prepare(countSql).get(...params) as { count: number }
    const total_count = countResult.count

    // Build cursor condition if present
    let cursorCondition = ''
    let cursorParams: (string | number | null)[] = []
    if (cursor) {
      const cursorResult = this.buildCursorCondition(cursor, sortBy)
      cursorCondition = cursorResult.condition
      cursorParams = cursorResult.params
    }

    // Execute data query with cursor and limit
    const dataConditions = cursor ? [...conditions, cursorCondition] : conditions
    const dataWhereClause = dataConditions.join(' AND ')
    const dataSql = `SELECT * FROM variants WHERE ${dataWhereClause} ORDER BY ${orderByClause} LIMIT ?`
    const dataParams = [...params, ...cursorParams, limit + 1]
    const results = this.db.prepare(dataSql).all(...dataParams) as Variant[]

    // Determine pagination state
    const has_more = results.length > limit
    const data = has_more ? results.slice(0, limit) : results

    // Build next cursor from last item
    let next_cursor: PaginationCursor | null = null
    if (has_more && data.length > 0) {
      const lastItem = data[data.length - 1]
      const sortValue = lastItem[primarySortKey as keyof Variant]
      next_cursor = {
        id: lastItem.id,
        sort_value: sortValue as number | string | null,
        sort_key: primarySortKey
      }
    }

    return {
      data,
      next_cursor,
      has_more,
      total_count
    }
  }

  /**
   * Search variants using FTS5 full-text search
   *
   * Searches gene_symbol and consequence fields using FTS5 prefix matching.
   * Results are ranked by BM25 relevance score.
   *
   * @param caseId - ID of the case to search within
   * @param query - Search query (prefix matching enabled)
   * @param limit - Maximum number of results (default: 50)
   * @returns Array of matching variants ordered by relevance
   */
  searchVariants(caseId: number, query: string, limit: number = 50): Variant[] {
    // Append * for prefix matching and quote the query for safety
    const ftsQuery = `"${query.replace(/"/g, '""')}"*`

    const results = this.db
      .prepare(
        `
      SELECT v.* FROM variants v
      JOIN variants_fts fts ON v.id = fts.rowid
      WHERE v.case_id = ? AND variants_fts MATCH ?
      ORDER BY bm25(variants_fts)
      LIMIT ?
    `
      )
      .all(caseId, ftsQuery, limit) as Variant[]

    return results
  }

  /**
   * Get all variants matching filter for export (no pagination)
   *
   * @param filter - Filter criteria including case_id (required)
   * @returns Array of all matching variants
   */
  getAllVariantsForExport(filter: VariantFilter): Variant[] {
    // Build dynamic WHERE clause (same logic as getVariants)
    const conditions: string[] = ['case_id = ?']
    const params: (string | number | null)[] = [filter.case_id]

    if (filter.gene_symbol !== undefined && filter.gene_symbol !== '') {
      conditions.push('gene_symbol LIKE ?')
      params.push(`%${filter.gene_symbol}%`)
    }

    if (filter.consequences !== undefined && filter.consequences.length > 0) {
      const placeholders = filter.consequences.map(() => '?').join(', ')
      conditions.push(`consequence IN (${placeholders})`)
      params.push(...filter.consequences)
    } else if (filter.consequence !== undefined && filter.consequence !== '') {
      conditions.push('consequence = ?')
      params.push(filter.consequence)
    }

    // Handle multi-select funcs (OR logic)
    if (filter.funcs !== undefined && filter.funcs.length > 0) {
      const placeholders = filter.funcs.map(() => '?').join(', ')
      conditions.push(`func IN (${placeholders})`)
      params.push(...filter.funcs)
    }

    // Handle multi-select clinvars (OR logic)
    if (filter.clinvars !== undefined && filter.clinvars.length > 0) {
      const placeholders = filter.clinvars.map(() => '?').join(', ')
      conditions.push(`clinvar IN (${placeholders})`)
      params.push(...filter.clinvars)
    }

    if (filter.gnomad_af_max !== undefined) {
      conditions.push('(gnomad_af IS NULL OR gnomad_af <= ?)')
      params.push(filter.gnomad_af_max)
    }

    if (filter.cadd_min !== undefined) {
      conditions.push('cadd >= ?')
      params.push(filter.cadd_min)
    }

    // General search query (hybrid: position, HGVS, or FTS5)
    if (filter.search_query != null && filter.search_query !== '') {
      const searchCondition = this.buildSearchCondition(filter.search_query, params)
      conditions.push(searchCondition)
    }

    // Exact variant coordinate filters (for cohort → case navigation)
    if (filter.chr != null && filter.chr !== '') {
      conditions.push('chr = ?')
      params.push(filter.chr)
    }
    if (filter.pos != null) {
      conditions.push('pos = ?')
      params.push(filter.pos)
    }
    if (filter.ref != null && filter.ref !== '') {
      conditions.push('ref = ?')
      params.push(filter.ref)
    }
    if (filter.alt != null && filter.alt !== '') {
      conditions.push('alt = ?')
      params.push(filter.alt)
    }

    const whereClause = conditions.join(' AND ')
    const sql = `SELECT * FROM variants WHERE ${whereClause} ORDER BY chr, pos`

    return this.db.prepare(sql).all(...params) as Variant[]
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
      this.db.pragma(`rekey='${newPassword}'`)
    } catch (error) {
      throw new DatabaseError(
        'Failed to change database encryption key',
        error instanceof Error ? error : undefined
      )
    }
  }

  /**
   * Get global annotation for a variant by chr:pos:ref:alt key
   *
   * @param chr - Chromosome
   * @param pos - Position
   * @param ref - Reference allele
   * @param alt - Alternate allele
   * @returns VariantAnnotation or null if not found
   */
  getGlobalAnnotation(
    chr: string,
    pos: number,
    ref: string,
    alt: string
  ): VariantAnnotation | null {
    const result = this.stmt(
      'SELECT * FROM variant_annotations WHERE chr = ? AND pos = ? AND ref = ? AND alt = ?'
    ).get(chr, pos, ref, alt) as VariantAnnotation | undefined

    return result ?? null
  }

  /**
   * Upsert global annotation for a variant (atomic operation)
   *
   * Uses INSERT ON CONFLICT to avoid race conditions.
   * Only updates fields provided in updates object (COALESCE pattern).
   *
   * @param chr - Chromosome
   * @param pos - Position
   * @param ref - Reference allele
   * @param alt - Alternate allele
   * @param updates - Partial annotation updates
   * @returns Updated or inserted VariantAnnotation
   */
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
    return this.runTransaction(() => {
      const now = Date.now()

      // Atomic upsert using INSERT ON CONFLICT
      // For INSERT: use IFNULL to default starred to 0 (satisfies NOT NULL constraint)
      // For UPDATE: use IFNULL to preserve existing value when null is passed
      const result = this.stmt(
        `
        INSERT INTO variant_annotations (chr, pos, ref, alt, global_comment, starred, acmg_classification, acmg_evidence, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, IFNULL(?, 0), ?, ?, ?, ?)
        ON CONFLICT(chr, pos, ref, alt) DO UPDATE SET
          global_comment = IFNULL(?, global_comment),
          starred = IFNULL(?, starred),
          acmg_classification = IFNULL(?, acmg_classification),
          acmg_evidence = IFNULL(?, acmg_evidence),
          updated_at = excluded.updated_at
        RETURNING *
      `
      ).get(
        chr,
        pos,
        ref,
        alt,
        updates.global_comment ?? null,
        updates.starred !== undefined ? (updates.starred ? 1 : 0) : null,
        updates.acmg_classification ?? null,
        updates.acmg_evidence ?? null,
        now,
        now,
        // Parameters for UPDATE IFNULL (same values, passed again for UPDATE clause)
        updates.global_comment ?? null,
        updates.starred !== undefined ? (updates.starred ? 1 : 0) : null,
        updates.acmg_classification ?? null,
        updates.acmg_evidence ?? null
      ) as VariantAnnotation

      return result
    })
  }

  /**
   * Delete global annotation for a variant
   *
   * Idempotent - no error if annotation doesn't exist.
   *
   * @param chr - Chromosome
   * @param pos - Position
   * @param ref - Reference allele
   * @param alt - Alternate allele
   */
  deleteGlobalAnnotation(chr: string, pos: number, ref: string, alt: string): void {
    this.stmt(
      'DELETE FROM variant_annotations WHERE chr = ? AND pos = ? AND ref = ? AND alt = ?'
    ).run(chr, pos, ref, alt)
  }

  /**
   * Get per-case annotation for a variant
   *
   * @param caseId - Case ID
   * @param variantId - Variant ID
   * @returns CaseVariantAnnotation or null if not found
   */
  getPerCaseAnnotation(caseId: number, variantId: number): CaseVariantAnnotation | null {
    const result = this.stmt(
      'SELECT * FROM case_variant_annotations WHERE case_id = ? AND variant_id = ?'
    ).get(caseId, variantId) as CaseVariantAnnotation | undefined

    return result ?? null
  }

  /**
   * Upsert per-case annotation for a variant (atomic operation)
   *
   * Uses INSERT ON CONFLICT to avoid race conditions.
   * Only updates fields provided in updates object (IFNULL pattern).
   * Starred and ACMG are per-case, not global.
   *
   * @param caseId - Case ID
   * @param variantId - Variant ID
   * @param updates - Partial annotation updates
   * @returns Updated or inserted CaseVariantAnnotation
   */
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
    return this.runTransaction(() => {
      const now = Date.now()

      // Atomic upsert using INSERT ON CONFLICT
      // For INSERT: use IFNULL to default starred to 0 (satisfies NOT NULL constraint)
      // For UPDATE: use IFNULL to preserve existing value when null is passed
      const result = this.stmt(
        `
        INSERT INTO case_variant_annotations (case_id, variant_id, per_case_comment, starred, acmg_classification, acmg_evidence, created_at, updated_at)
        VALUES (?, ?, ?, IFNULL(?, 0), ?, ?, ?, ?)
        ON CONFLICT(case_id, variant_id) DO UPDATE SET
          per_case_comment = IFNULL(?, per_case_comment),
          starred = IFNULL(?, starred),
          acmg_classification = IFNULL(?, acmg_classification),
          acmg_evidence = IFNULL(?, acmg_evidence),
          updated_at = excluded.updated_at
        RETURNING *
      `
      ).get(
        caseId,
        variantId,
        updates.per_case_comment ?? null,
        updates.starred !== undefined ? (updates.starred ? 1 : 0) : null,
        updates.acmg_classification ?? null,
        updates.acmg_evidence ?? null,
        now,
        now,
        // Parameters for UPDATE IFNULL (same values, passed again for UPDATE clause)
        updates.per_case_comment ?? null,
        updates.starred !== undefined ? (updates.starred ? 1 : 0) : null,
        updates.acmg_classification ?? null,
        updates.acmg_evidence ?? null
      ) as CaseVariantAnnotation

      return result
    })
  }

  /**
   * Delete per-case annotation for a variant
   *
   * Idempotent - no error if annotation doesn't exist.
   *
   * @param caseId - Case ID
   * @param variantId - Variant ID
   */
  deletePerCaseAnnotation(caseId: number, variantId: number): void {
    this.stmt('DELETE FROM case_variant_annotations WHERE case_id = ? AND variant_id = ?').run(
      caseId,
      variantId
    )
  }

  /**
   * Get all annotations for a variant in context (global + per-case)
   *
   * Returns both global annotation (by chr:pos:ref:alt) and per-case annotation
   * (by case_id + variant_id) in a single query result.
   *
   * @param caseId - Case ID
   * @param chr - Chromosome
   * @param pos - Position
   * @param ref - Reference allele
   * @param alt - Alternate allele
   * @returns Object with global and perCase annotations (null if not found)
   */
  getAnnotationsForVariant(
    caseId: number,
    chr: string,
    pos: number,
    ref: string,
    alt: string
  ): { global: VariantAnnotation | null; perCase: CaseVariantAnnotation | null } {
    // First get variant_id for this case + variant coordinates
    const variant = this.stmt(
      'SELECT id FROM variants WHERE case_id = ? AND chr = ? AND pos = ? AND ref = ? AND alt = ?'
    ).get(caseId, chr, pos, ref, alt) as { id: number } | undefined

    const variantId = variant?.id

    // Get global annotation
    const global = this.getGlobalAnnotation(chr, pos, ref, alt)

    // Get per-case annotation if variant exists in this case
    const perCase = variantId !== undefined ? this.getPerCaseAnnotation(caseId, variantId) : null

    return { global, perCase }
  }

  // ============================================================
  // Case Metadata Operations
  // ============================================================

  /**
   * Get case metadata by case ID
   *
   * @param caseId - Case ID
   * @returns CaseMetadata or null if not found
   */
  getCaseMetadata(caseId: number): CaseMetadata | null {
    const result = this.stmt('SELECT * FROM case_metadata WHERE case_id = ?').get(caseId) as
      | CaseMetadata
      | undefined

    return result ?? null
  }

  /**
   * Upsert case metadata (atomic operation)
   *
   * Uses INSERT ON CONFLICT to avoid race conditions.
   * Only updates fields provided in updates object (COALESCE pattern).
   *
   * @param caseId - Case ID
   * @param updates - Partial metadata updates
   * @returns Updated or inserted CaseMetadata
   */
  upsertCaseMetadata(
    caseId: number,
    updates: { affected_status?: string | null; notes?: string | null }
  ): CaseMetadata {
    return this.runTransaction(() => {
      const now = Date.now()

      const result = this.stmt(
        `
        INSERT INTO case_metadata (case_id, affected_status, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(case_id) DO UPDATE SET
          affected_status = COALESCE(excluded.affected_status, affected_status),
          notes = COALESCE(excluded.notes, notes),
          updated_at = excluded.updated_at
        RETURNING *
      `
      ).get(
        caseId,
        updates.affected_status ?? null,
        updates.notes ?? null,
        now,
        now
      ) as CaseMetadata

      return result
    })
  }

  // ============================================================
  // Cohort Group Operations
  // ============================================================

  /**
   * List all cohort groups ordered by name
   *
   * @returns Array of all cohort groups
   */
  listCohortGroups(): CohortGroup[] {
    return this.stmt('SELECT * FROM cohort_groups ORDER BY name').all() as CohortGroup[]
  }

  /**
   * Create a new cohort group
   *
   * @param name - Cohort name
   * @param description - Optional description
   * @returns Created CohortGroup
   */
  createCohortGroup(name: string, description?: string | null): CohortGroup {
    const now = Date.now()
    const result = this.stmt(
      'INSERT INTO cohort_groups (name, description, created_at) VALUES (?, ?, ?) RETURNING *'
    ).get(name, description ?? null, now) as CohortGroup

    return result
  }

  /**
   * Delete a cohort group
   *
   * Note: CASCADE handles automatic deletion of case_cohort_links
   *
   * @param cohortId - Cohort ID
   */
  deleteCohortGroup(cohortId: number): void {
    this.stmt('DELETE FROM cohort_groups WHERE id = ?').run(cohortId)
  }

  /**
   * Get cohort group by name
   *
   * @param name - Cohort name
   * @returns CohortGroup or null if not found
   */
  getCohortGroupByName(name: string): CohortGroup | null {
    const result = this.stmt('SELECT * FROM cohort_groups WHERE name = ?').get(name) as
      | CohortGroup
      | undefined

    return result ?? null
  }

  // ============================================================
  // Case-Cohort Link Operations
  // ============================================================

  /**
   * Get all cohorts for a case
   *
   * @param caseId - Case ID
   * @returns Array of cohort groups
   */
  getCaseCohorts(caseId: number): CohortGroup[] {
    return this.stmt(
      `
      SELECT cg.* FROM cohort_groups cg
      JOIN case_cohort_links ccl ON cg.id = ccl.cohort_id
      WHERE ccl.case_id = ?
      ORDER BY cg.name
    `
    ).all(caseId) as CohortGroup[]
  }

  /**
   * Assign a case to a cohort
   *
   * Idempotent - no error if link already exists
   *
   * @param caseId - Case ID
   * @param cohortId - Cohort ID
   */
  assignCaseCohort(caseId: number, cohortId: number): void {
    this.stmt(
      'INSERT INTO case_cohort_links (case_id, cohort_id) VALUES (?, ?) ON CONFLICT DO NOTHING'
    ).run(caseId, cohortId)
  }

  /**
   * Remove a case from a cohort
   *
   * Idempotent - no error if link doesn't exist
   *
   * @param caseId - Case ID
   * @param cohortId - Cohort ID
   */
  removeCaseCohort(caseId: number, cohortId: number): void {
    this.stmt('DELETE FROM case_cohort_links WHERE case_id = ? AND cohort_id = ?').run(
      caseId,
      cohortId
    )
  }

  /**
   * Replace all cohort assignments for a case (atomic operation)
   *
   * @param caseId - Case ID
   * @param cohortIds - Array of cohort IDs
   */
  setCaseCohorts(caseId: number, cohortIds: number[]): void {
    this.runTransaction(() => {
      // Delete existing assignments
      this.stmt('DELETE FROM case_cohort_links WHERE case_id = ?').run(caseId)

      // Insert new assignments
      const insert = this.stmt('INSERT INTO case_cohort_links (case_id, cohort_id) VALUES (?, ?)')
      for (const cohortId of cohortIds) {
        insert.run(caseId, cohortId)
      }
    })
  }

  // ============================================================
  // Case HPO Term Operations
  // ============================================================

  /**
   * Get all HPO terms for a case
   *
   * @param caseId - Case ID
   * @returns Array of HPO terms
   */
  getCaseHpoTerms(caseId: number): CaseHpoTerm[] {
    return this.stmt('SELECT * FROM case_hpo_terms WHERE case_id = ? ORDER BY hpo_id').all(
      caseId
    ) as CaseHpoTerm[]
  }

  /**
   * Assign HPO term to case (upserts to update label)
   *
   * @param caseId - Case ID
   * @param hpoId - HPO ID (e.g., "HP:0001250")
   * @param hpoLabel - HPO label
   * @returns Created or updated CaseHpoTerm
   */
  assignCaseHpoTerm(caseId: number, hpoId: string, hpoLabel: string): CaseHpoTerm {
    const now = Date.now()
    const result = this.stmt(
      `
      INSERT INTO case_hpo_terms (case_id, hpo_id, hpo_label, created_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(case_id, hpo_id) DO UPDATE SET hpo_label = excluded.hpo_label
      RETURNING *
    `
    ).get(caseId, hpoId, hpoLabel, now) as CaseHpoTerm

    return result
  }

  /**
   * Remove HPO term from case
   *
   * Idempotent - no error if term doesn't exist
   *
   * @param caseId - Case ID
   * @param hpoId - HPO ID
   */
  removeCaseHpoTerm(caseId: number, hpoId: string): void {
    this.stmt('DELETE FROM case_hpo_terms WHERE case_id = ? AND hpo_id = ?').run(caseId, hpoId)
  }

  /**
   * Close the database connection
   *
   * Should be called when the application is shutting down.
   */
  close(): void {
    this.clearStatementCache()
    this.db.close()
  }

  /**
   * Get the underlying database instance
   *
   * Exposed for testing purposes only. Use with caution.
   */
  get database(): DatabaseType {
    return this.db
  }
}
