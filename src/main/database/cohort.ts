/**
 * CohortService - Aggregated variant analysis across all cases
 *
 * Provides cohort-level queries for multi-case analysis.
 */

import type Database from 'better-sqlite3-multiple-ciphers'
import type { Statement } from 'better-sqlite3-multiple-ciphers'
import type { CohortVariant, CohortSummary, CohortSearchParams } from '../../shared/types/cohort'

/**
 * Sortable columns for cohort queries
 * Maps column keys to SQL column names/expressions
 */
const SORTABLE_COLUMNS: Record<string, string> = {
  chr: 'chr',
  pos: 'pos',
  gene_symbol: 'gene_symbol',
  carrier_count: 'carrier_count',
  cohort_frequency: 'cohort_frequency',
  het_count: 'het_count',
  hom_count: 'hom_count'
}

/**
 * CohortService class
 *
 * Provides cohort-level aggregation queries.
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
   * Get aggregated cohort variants
   *
   * Returns variants grouped by (chr, pos, ref, alt) with carrier counts,
   * cohort frequency, and het/hom breakdown.
   *
   * @param params - Search and pagination parameters
   * @returns Object with data array and total_count
   */
  getCohortVariants(params: CohortSearchParams): { data: CohortVariant[]; total_count: number } {
    const limit = params.limit ?? 50
    const offset = params.offset ?? 0
    const sortBy = params.sort_by !== undefined ? SORTABLE_COLUMNS[params.sort_by] : undefined
    const sortOrder = params.sort_order ?? 'desc'

    // Get total case count (used for cohort_frequency calculation)
    const totalCasesResult = this.db.prepare('SELECT COUNT(*) as count FROM cases').get() as {
      count: number
    }
    const totalCases = totalCasesResult.count

    if (totalCases === 0) {
      // No cases in database - return empty result
      return { data: [], total_count: 0 }
    }

    // Build WHERE clause for search
    const whereConditions: string[] = []
    const params_array: (string | number)[] = []

    if (params.search_term !== undefined && params.search_term !== '') {
      // Simple search on gene_symbol or chr:pos format
      whereConditions.push('(gene_symbol LIKE ? OR chr || ":" || pos LIKE ?)')
      const searchPattern = `%${params.search_term}%`
      params_array.push(searchPattern, searchPattern)
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : ''

    // Build ORDER BY clause
    let orderByClause = 'ORDER BY carrier_count DESC, pos ASC'
    if (sortBy !== undefined) {
      const direction = sortOrder.toUpperCase()
      orderByClause = `ORDER BY ${sortBy} ${direction}, pos ASC`
    }

    // Main aggregation query
    const sql = `
      SELECT
        chr,
        pos,
        ref,
        alt,
        MAX(gene_symbol) as gene_symbol,
        COUNT(DISTINCT case_id) as carrier_count,
        ${totalCases} as total_cases,
        CAST(COUNT(DISTINCT case_id) AS REAL) / ${totalCases} as cohort_frequency,
        SUM(CASE WHEN gt_num IN ('0/1', '1/0', '0|1', '1|0') THEN 1 ELSE 0 END) as het_count,
        SUM(CASE WHEN gt_num IN ('1/1', '1|1') THEN 1 ELSE 0 END) as hom_count,
        chr || ':' || pos || ':' || ref || ':' || alt as variant_key
      FROM variants
      ${whereClause}
      GROUP BY chr, pos, ref, alt
      ${orderByClause}
      LIMIT ? OFFSET ?
    `

    const stmt = this.getStatement(sql)
    const results = stmt.all(...params_array, limit, offset) as CohortVariant[]

    // Get total count (same query without LIMIT/OFFSET)
    const countSql = `
      SELECT COUNT(*) as count
      FROM (
        SELECT chr, pos, ref, alt
        FROM variants
        ${whereClause}
        GROUP BY chr, pos, ref, alt
      )
    `

    const countStmt = this.getStatement(countSql)
    const countResult = countStmt.get(...params_array) as { count: number }
    const totalCount = countResult.count

    return {
      data: results,
      total_count: totalCount
    }
  }

  /**
   * Get cohort summary statistics
   *
   * @returns Summary with total cases, variants, unique variants, etc.
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

    // Unique variants (distinct chr:pos:ref:alt)
    const uniqueVariantsResult = this.db
      .prepare(
        `SELECT COUNT(DISTINCT chr || ':' || pos || ':' || ref || ':' || alt) as count FROM variants`
      )
      .get() as { count: number }
    const uniqueVariants = uniqueVariantsResult.count

    // Genes with variants
    const genesResult = this.db
      .prepare('SELECT COUNT(DISTINCT gene_symbol) as count FROM variants WHERE gene_symbol IS NOT NULL')
      .get() as { count: number }
    const genesWithVariants = genesResult.count

    // Calculate average (handle division by zero)
    const avgVariantsPerCase = totalCases > 0 ? totalVariants / totalCases : 0

    return {
      total_cases: totalCases,
      total_variants: totalVariants,
      unique_variants: uniqueVariants,
      avg_variants_per_case: avgVariantsPerCase,
      genes_with_variants: genesWithVariants
    }
  }

  /**
   * Close and clear statement cache
   */
  close(): void {
    this.statementCache.clear()
  }
}
