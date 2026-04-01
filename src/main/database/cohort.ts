/**
 * CohortService - Aggregated variant analysis across all cases
 *
 * Reads from pre-computed cohort_variant_summary and gene_burden_summary tables.
 * Summary tables are populated by CohortSummaryService.rebuild() after import/delete.
 */

import type Database from 'better-sqlite3-multiple-ciphers'
import type { Statement } from 'better-sqlite3-multiple-ciphers'
import type {
  CohortVariant,
  CohortSummary,
  CohortSearchParams,
  CohortCarrier,
  GeneBurden,
  CohortPaginatedResult
} from '../../shared/types/cohort'
import type { ColumnFilterMeta } from '../../shared/types/column-filters'
import { sqlPlaceholders } from './sql-utils'

/**
 * Sortable columns for cohort queries
 * Maps column keys to SQL column names on cohort_variant_summary
 */
const SORTABLE_COLUMNS: Record<string, string> = {
  chr: 'chr',
  pos: 'pos',
  gene_symbol: 'gene_symbol',
  cdna: 'cdna',
  aa_change: 'aa_change',
  carrier_count: 'carrier_count',
  cohort_frequency: 'cohort_frequency',
  het_count: 'het_count',
  hom_count: 'hom_count',
  consequence: 'consequence',
  func: 'func',
  clinvar: 'clinvar',
  gnomad_af: 'gnomad_af',
  cadd_phred: 'cadd',
  transcript: 'transcript'
}

/** Numeric columns for column metadata auto-detection (data type inference) */
const NUMERIC_COLUMNS = new Set([
  'pos',
  'carrier_count',
  'cohort_frequency',
  'het_count',
  'hom_count',
  'gnomad_af',
  'cadd_phred'
])

/**
 * CohortService class
 *
 * Provides cohort-level aggregation queries reading from summary tables.
 */
export class CohortService {
  private db: Database.Database
  private statementCache: Map<string, Statement>

  constructor(db: Database.Database) {
    this.db = db
    this.statementCache = new Map()
  }

  /**
   * Get or create a cached prepared statement
   */
  private getStatement(sql: string): Statement {
    let stmt = this.statementCache.get(sql)
    if (stmt === undefined) {
      stmt = this.db.prepare(sql)
      this.statementCache.set(sql, stmt)
    }
    return stmt
  }

  /**
   * Build the WHERE clause and bound parameters for a cohort search.
   * Extracted so that count-only and export paths can reuse the same logic.
   */
  private buildWhereClause(params: CohortSearchParams): {
    whereClause: string
    paramsArray: (string | number)[]
  } {
    const whereConditions: string[] = []
    const paramsArray: (string | number)[] = []

    // Search term handling with LIKE-based strategy
    if (params.search_term !== undefined && params.search_term !== '') {
      const term = params.search_term.trim()
      const hasBooleanOps = /\b(AND|OR|NOT)\b/.test(term)

      if (!hasBooleanOps) {
        const singleCondition = this.buildSingleTermCondition(term, paramsArray)
        whereConditions.push(singleCondition)
      } else {
        const sqlCondition = this.buildBooleanSearchCondition(term, paramsArray)
        whereConditions.push(sqlCondition)
      }
    }

    // Gene symbol filter (partial match)
    if (params.gene_symbol !== undefined && params.gene_symbol !== '') {
      whereConditions.push('cvs.gene_symbol LIKE ?')
      paramsArray.push(`%${params.gene_symbol}%`)
    }

    // Consequence/Impact filter (IN clause)
    if (params.consequences !== undefined && params.consequences.length > 0) {
      const placeholders = sqlPlaceholders(params.consequences.length)
      whereConditions.push(`cvs.consequence IN (${placeholders})`)
      paramsArray.push(...params.consequences)
    }

    // Func filter (IN clause)
    if (params.funcs !== undefined && params.funcs.length > 0) {
      const placeholders = sqlPlaceholders(params.funcs.length)
      whereConditions.push(`cvs.func IN (${placeholders})`)
      paramsArray.push(...params.funcs)
    }

    // ClinVar filter (exact match via IN clause)
    if (params.clinvars !== undefined && params.clinvars.length > 0) {
      const placeholders = sqlPlaceholders(params.clinvars.length)
      whereConditions.push(`cvs.clinvar IN (${placeholders})`)
      paramsArray.push(...params.clinvars)
    }

    // gnomAD AF max filter
    if (params.gnomad_af_max !== undefined && params.gnomad_af_max > 0) {
      whereConditions.push('(cvs.gnomad_af IS NULL OR cvs.gnomad_af <= ?)')
      paramsArray.push(params.gnomad_af_max)
    }

    // CADD min filter
    if (params.cadd_min !== undefined && params.cadd_min >= 0) {
      whereConditions.push('(cvs.cadd IS NULL OR cvs.cadd >= ?)')
      paramsArray.push(params.cadd_min)
    }

    // Carrier count min filter (now a regular WHERE, not HAVING)
    if (params.carrier_count_min !== undefined && params.carrier_count_min > 0) {
      whereConditions.push('cvs.carrier_count >= ?')
      paramsArray.push(params.carrier_count_min)
    }

    if (params.max_internal_af !== undefined && params.max_internal_af > 0) {
      whereConditions.push('(cvs.cohort_frequency IS NULL OR cvs.cohort_frequency <= ?)')
      paramsArray.push(params.max_internal_af)
    }

    // Annotation filters (use denormalized columns from v14)
    if (params.starred_only === true) {
      whereConditions.push('cvs.has_star = 1')
    }

    if (params.has_comment === true) {
      whereConditions.push('cvs.has_comment = 1')
    }

    if (params.acmg_classifications !== undefined && params.acmg_classifications.length > 0) {
      const placeholders = sqlPlaceholders(params.acmg_classifications.length)
      whereConditions.push(`cvs.acmg_best IN (${placeholders})`)
      paramsArray.push(...params.acmg_classifications)
    }

    // Panel interval filter (region-based)
    if (params.panel_intervals && params.panel_intervals.length > 0) {
      const intervalConditions = params.panel_intervals.map((iv) => {
        paramsArray.push(iv.chr, iv.start, iv.end)
        return '(cvs.chr = ? AND cvs.pos BETWEEN ? AND ?)'
      })
      whereConditions.push(`(${intervalConditions.join(' OR ')})`)
    }

    // Per-column typed filters
    if (params.column_filters !== undefined) {
      for (const [column, filterDef] of Object.entries(params.column_filters)) {
        if (SORTABLE_COLUMNS[column] === undefined) continue
        const sqlColumn = SORTABLE_COLUMNS[column]
        const { operator, value } = filterDef

        if (operator === 'in' && Array.isArray(value)) {
          if (value.length === 0) continue
          const placeholders = sqlPlaceholders(value.length)
          whereConditions.push(`cvs.${sqlColumn} IN (${placeholders})`)
          paramsArray.push(...value)
        } else if (operator === 'like' && typeof value === 'string') {
          if (value.trim() === '') continue // Skip empty — LIKE '%%' excludes NULLs unnecessarily
          whereConditions.push(`cvs.${sqlColumn} LIKE ? COLLATE NOCASE`)
          paramsArray.push(`%${value}%`)
        } else if (
          ['=', '!='].includes(operator) &&
          (typeof value === 'string' || typeof value === 'number')
        ) {
          // Exact match — NULLs excluded
          whereConditions.push(`cvs.${sqlColumn} ${operator} ?`)
          paramsArray.push(value)
        } else if (
          ['<', '>', '<=', '>='].includes(operator) &&
          (typeof value === 'string' || typeof value === 'number')
        ) {
          // Range comparison — includeEmpty defaults to true
          const includeNulls = filterDef.includeEmpty !== false
          if (includeNulls) {
            whereConditions.push(`(cvs.${sqlColumn} IS NULL OR cvs.${sqlColumn} ${operator} ?)`)
          } else {
            whereConditions.push(`cvs.${sqlColumn} ${operator} ?`)
          }
          paramsArray.push(value)
        }
      }
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : ''
    return { whereClause, paramsArray }
  }

  /**
   * Get aggregated cohort variants from pre-computed summary table
   */
  getCohortVariants(params: CohortSearchParams): CohortPaginatedResult {
    const limit = params.limit ?? 50
    const offset = params.offset ?? 0
    const validatedSortKey =
      params.sort_by !== undefined && SORTABLE_COLUMNS[params.sort_by] !== undefined
        ? params.sort_by
        : 'carrier_count'
    const sortBy = SORTABLE_COLUMNS[validatedSortKey]
    const sortOrder = params.sort_order ?? 'desc'

    // Get total case count (used for cohort_frequency calculation)
    const totalCasesResult = this.db.prepare('SELECT COUNT(*) as count FROM cases').get() as {
      count: number
    }
    const totalCases = totalCasesResult.count

    if (totalCases === 0) {
      return { data: [], total_count: 0 }
    }

    const { whereClause, paramsArray } = this.buildWhereClause(params)

    // Count query (only when filters change, not on page/sort change)
    let totalCount = 0
    if (params._count_needed !== false) {
      const countSql = `
        SELECT COUNT(*) as count
        FROM cohort_variant_summary cvs
        ${whereClause}
      `
      const countResult = this.db.prepare(countSql).get(...paramsArray) as { count: number }
      totalCount = countResult.count
    }

    // Build ORDER BY — use PK columns as tiebreaker instead of variant_key
    const direction = sortOrder.toUpperCase()
    const orderByClause = `ORDER BY ${sortBy} ${direction} NULLS LAST, chr ASC, pos ASC, ref ASC, alt ASC`

    // Data query — no window function, LIMIT benefits from early termination
    const sql = `
      SELECT
        cvs.chr,
        cvs.pos,
        cvs.ref,
        cvs.alt,
        cvs.gene_symbol,
        cvs.cdna,
        cvs.aa_change,
        cvs.carrier_count,
        ${totalCases} AS total_cases,
        cvs.cohort_frequency,
        cvs.het_count,
        cvs.hom_count,
        cvs.variant_key,
        cvs.consequence,
        cvs.func,
        cvs.clinvar,
        cvs.gnomad_af,
        cvs.cadd AS cadd_phred,
        cvs.transcript,
        cvs.omim_mim_number AS omim_id
      FROM cohort_variant_summary cvs
      ${whereClause}
      ${orderByClause}
      LIMIT ? OFFSET ?
    `

    const stmt = this.getStatement(sql)
    const results = stmt.all(...paramsArray, limit, offset) as CohortVariant[]

    return {
      data: results,
      total_count: totalCount
    }
  }

  /**
   * Build a SQL condition for a single search token.
   * Uses LIKE-based search on summary table columns.
   */
  private buildSingleTermCondition(token: string, paramsArray: (string | number)[]): string {
    const genomicPosPattern = /^(?:chr)?(\d{1,2}|X|Y|MT?):(\d+)$/i
    const hgvsPattern = /^[cp]\./

    if (genomicPosPattern.test(token)) {
      const match = token.match(genomicPosPattern)
      if (match !== null) {
        paramsArray.push(match[1], parseInt(match[2], 10))
        return '(cvs.chr = ? AND cvs.pos = ?)'
      }
    }

    if (hgvsPattern.test(token)) {
      const searchPattern = `%${token}%`
      paramsArray.push(searchPattern, searchPattern)
      return '(cvs.cdna LIKE ? OR cvs.aa_change LIKE ?)'
    }

    // Default: LIKE-based search on gene_symbol, consequence, omim_mim_number
    const searchPattern = `%${token}%`
    paramsArray.push(searchPattern, searchPattern, searchPattern)
    return '(cvs.gene_symbol LIKE ? COLLATE NOCASE OR cvs.consequence LIKE ? COLLATE NOCASE OR cvs.omim_mim_number LIKE ? COLLATE NOCASE)'
  }

  /**
   * Build a SQL boolean expression from a search string containing AND/OR/NOT.
   */
  private buildBooleanSearchCondition(term: string, paramsArray: (string | number)[]): string {
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
        sqlParts.push(this.buildSingleTermCondition(part, paramsArray))
      }
    }

    return `(${sqlParts.join(' ')})`
  }

  /**
   * Get cohort summary statistics
   */
  getCohortSummary(): CohortSummary {
    // Total cases
    const totalCasesResult = this.db.prepare('SELECT COUNT(*) as count FROM cases').get() as {
      count: number
    }
    const totalCases = totalCasesResult.count

    // Total variant observations
    const totalVariantsResult = this.db.prepare('SELECT COUNT(*) as count FROM variants').get() as {
      count: number
    }
    const totalVariants = totalVariantsResult.count

    // Unique variants — read from pre-computed summary
    const uniqueVariantsResult = this.db
      .prepare('SELECT COUNT(*) as count FROM cohort_variant_summary')
      .get() as { count: number }
    const uniqueVariants = uniqueVariantsResult.count

    // Genes with variants — read from pre-computed summary
    const genesResult = this.db
      .prepare(
        'SELECT COUNT(DISTINCT gene_symbol) as count FROM cohort_variant_summary WHERE gene_symbol IS NOT NULL'
      )
      .get() as { count: number }
    const genesWithVariants = genesResult.count

    // Calculate average (handle division by zero)
    const avgVariantsPerCase = totalCases > 0 ? totalVariants / totalCases : 0

    // Check if variant_annotations table exists (created in migration v2)
    const annotationTableExists =
      (
        this.db
          .prepare(
            "SELECT COUNT(*) as count FROM sqlite_master WHERE type='table' AND name='variant_annotations'"
          )
          .get() as { count: number }
      ).count > 0

    // Starred variants (global annotations)
    let starredVariants = 0
    let acmgRows: Array<{ acmg_classification: string; count: number }> = []

    if (annotationTableExists) {
      const starredResult = this.db
        .prepare('SELECT COUNT(*) as count FROM variant_annotations WHERE starred = 1')
        .get() as { count: number }
      starredVariants = starredResult.count

      // ACMG distribution (global annotations)
      acmgRows = this.db
        .prepare(
          `SELECT acmg_classification, COUNT(*) as count
           FROM variant_annotations
           WHERE acmg_classification IS NOT NULL
           GROUP BY acmg_classification`
        )
        .all() as Array<{ acmg_classification: string; count: number }>
    }

    const acmgCounts = {
      pathogenic: 0,
      likely_pathogenic: 0,
      vus: 0,
      likely_benign: 0,
      benign: 0
    }
    for (const row of acmgRows) {
      switch (row.acmg_classification) {
        case 'Pathogenic':
          acmgCounts.pathogenic = row.count
          break
        case 'Likely Pathogenic':
          acmgCounts.likely_pathogenic = row.count
          break
        case 'VUS':
          acmgCounts.vus = row.count
          break
        case 'Likely Benign':
          acmgCounts.likely_benign = row.count
          break
        case 'Benign':
          acmgCounts.benign = row.count
          break
      }
    }

    return {
      total_cases: totalCases,
      total_variants: totalVariants,
      unique_variants: uniqueVariants,
      avg_variants_per_case: avgVariantsPerCase,
      genes_with_variants: genesWithVariants,
      starred_variants: starredVariants,
      acmg_counts: acmgCounts
    }
  }

  /**
   * Get carriers for a specific variant
   */
  getCarriers(chr: string, pos: number, ref: string, alt: string): CohortCarrier[] {
    const sql = `
      SELECT
        v.case_id,
        c.name as case_name,
        MAX(v.gt_num) as gt_num
      FROM variants v
      JOIN cases c ON v.case_id = c.id
      WHERE v.chr = ? AND v.pos = ? AND v.ref = ? AND v.alt = ?
      GROUP BY v.case_id, c.name
      ORDER BY c.name
    `

    const stmt = this.getStatement(sql)
    return stmt.all(chr, pos, ref, alt) as CohortCarrier[]
  }

  /**
   * Get gene-level burden analysis from pre-computed summary
   */
  getGeneBurden(): GeneBurden[] {
    const sql = `
      SELECT gene_symbol, variant_count, unique_variant_count,
        affected_case_count,
        (SELECT COUNT(*) FROM cases) AS total_cases
      FROM gene_burden_summary
      ORDER BY affected_case_count DESC, variant_count DESC
    `
    const stmt = this.getStatement(sql)
    return stmt.all() as GeneBurden[]
  }

  /** Cached column metadata — invalidated on summary rebuild */
  private _columnMetaCache: ColumnFilterMeta[] | null = null

  /** Clear cached column metadata (call after cohort summary rebuild) */
  invalidateColumnMetaCache(): void {
    this._columnMetaCache = null
  }

  /**
   * Get per-column metadata from cohort_variant_summary for filter UI auto-detection.
   *
   * Uses a single aggregate query to compute all COUNT(DISTINCT), MIN, MAX values
   * in one table scan, then fetches distinct values only for low-cardinality columns.
   * Results are cached and invalidated on summary rebuild.
   */
  getColumnMeta(): ColumnFilterMeta[] {
    if (this._columnMetaCache !== null) return this._columnMetaCache

    const DISTINCT_THRESHOLD = 50
    const entries = Object.entries(SORTABLE_COLUMNS)

    // Single-pass aggregate: compute COUNT(DISTINCT), MIN, MAX for all columns at once
    const selectParts = entries.map(([key, sqlCol]) => {
      const parts = [`COUNT(DISTINCT ${sqlCol}) AS cnt_${key}`]
      if (NUMERIC_COLUMNS.has(key)) {
        parts.push(`MIN(${sqlCol}) AS min_${key}`)
        parts.push(`MAX(${sqlCol}) AS max_${key}`)
      }
      return parts.join(', ')
    })
    const aggRow = this.db
      .prepare(`SELECT ${selectParts.join(', ')} FROM cohort_variant_summary`)
      .get() as Record<string, number | null>

    // Build metadata from aggregate results
    const meta: ColumnFilterMeta[] = []
    // Collect low-cardinality columns for UNION ALL distinct-value fetch
    const lowCardColumns: Array<{ key: string; sqlCol: string }> = []

    for (const [key, sqlCol] of entries) {
      const isNumeric = NUMERIC_COLUMNS.has(key)
      const distinctCount = (aggRow[`cnt_${key}`] as number) ?? 0

      const entry: ColumnFilterMeta = {
        key,
        dataType: isNumeric ? 'numeric' : 'text',
        distinctCount
      }

      if (isNumeric) {
        entry.min = (aggRow[`min_${key}`] as number | null) ?? undefined
        entry.max = (aggRow[`max_${key}`] as number | null) ?? undefined
      }

      if (distinctCount > 0 && distinctCount <= DISTINCT_THRESHOLD) {
        lowCardColumns.push({ key, sqlCol })
      }

      meta.push(entry)
    }

    // Single UNION ALL query for all low-cardinality distinct values
    if (lowCardColumns.length > 0) {
      const unionParts = lowCardColumns.map(
        ({ key, sqlCol }) =>
          `SELECT '${key}' AS col_key, CAST(${sqlCol} AS TEXT) AS val FROM cohort_variant_summary WHERE ${sqlCol} IS NOT NULL GROUP BY ${sqlCol}`
      )
      const rows = this.db.prepare(unionParts.join(' UNION ALL ')).all() as Array<{
        col_key: string
        val: string
      }>

      // Group distinct values by column key
      const valuesByKey = new Map<string, string[]>()
      for (const row of rows) {
        let arr = valuesByKey.get(row.col_key)
        if (arr === undefined) {
          arr = []
          valuesByKey.set(row.col_key, arr)
        }
        arr.push(row.val)
      }

      // Attach to metadata entries
      for (const entry of meta) {
        const values = valuesByKey.get(entry.key)
        if (values !== undefined) {
          entry.distinctValues = values.sort()
        }
      }
    }

    this._columnMetaCache = meta
    return meta
  }

  /**
   * Close and clear statement cache
   */
  close(): void {
    this.statementCache.clear()
  }
}
