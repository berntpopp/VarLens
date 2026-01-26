/**
 * DatabaseService - Core database service for Varlens
 *
 * Manages SQLite connection, schema initialization, and case CRUD operations.
 * Uses better-sqlite3 for synchronous database access with prepared statement caching.
 */

import Database from 'better-sqlite3'
import type { Database as DatabaseType, Statement } from 'better-sqlite3'
import { initializeSchema } from './schema'
import type {
  Case,
  Variant,
  VariantFilter,
  PaginationCursor,
  PaginatedResult,
  SortItem
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

  /**
   * Create a new DatabaseService instance
   *
   * @param dbPath - Path to SQLite database file. Defaults to ':memory:' for testing.
   *                 In production, pass app.getPath('userData') + '/varlens.db'
   * @throws DatabaseError if database initialization fails
   */
  constructor(dbPath: string = ':memory:') {
    try {
      this.db = new Database(dbPath)
      this.statementCache = new Map()

      // Enable WAL mode for better concurrent read performance
      this.db.pragma('journal_mode = WAL')

      // Enable foreign key constraints
      this.db.pragma('foreign_keys = ON')

      // Initialize database schema
      initializeSchema(this.db)
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
    if (!statement) {
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
      if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
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
      INSERT INTO variants (case_id, chr, pos, ref, alt, gene_symbol, consequence, gnomad_af, cadd, clinvar, gt_num, func, qual, hpo_sim_score, transcript, cdna, aa_change, hpo_match, moi)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    // Log first variant for debugging
    if (variants.length > 0) {
      const v = variants[0]
      console.log('DEBUG: First variant keys:', Object.keys(v))
      console.log('DEBUG: First variant values:', JSON.stringify(v, null, 2))
      console.log('DEBUG: Parameter count expected: 19')
      const params = [
        caseId,
        v.chr,
        v.pos,
        v.ref,
        v.alt,
        v.gene_symbol,
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
        params.map((p) => (Array.isArray(p) ? 'ARRAY!' : typeof p))
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
      if (!sqlColumn) {
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
    if (!clauses.some((c) => c.startsWith('id '))) {
      clauses.push('id ASC')
    }

    return clauses.join(', ')
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

    // Include NULL CADD (unknown could be damaging) OR values >= threshold
    if (filter.cadd_min !== undefined) {
      conditions.push('(cadd IS NULL OR cadd >= ?)')
      params.push(filter.cadd_min)
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
      conditions.push('(cadd IS NULL OR cadd >= ?)')
      params.push(filter.cadd_min)
    }

    const whereClause = conditions.join(' AND ')
    const sql = `SELECT * FROM variants WHERE ${whereClause} ORDER BY chr, pos`

    return this.db.prepare(sql).all(...params) as Variant[]
  }

  /**
   * Close the database connection
   *
   * Should be called when the application is shutting down.
   */
  close(): void {
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
