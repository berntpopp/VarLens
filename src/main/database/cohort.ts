/**
 * CohortService - Aggregated variant analysis across all cases
 *
 * Provides cohort-level queries for multi-case analysis.
 */

import type Database from 'better-sqlite3-multiple-ciphers'
import type { Statement } from 'better-sqlite3-multiple-ciphers'
import type {
  CohortVariant,
  CohortSummary,
  CohortSearchParams,
  CohortCarrier,
  GeneBurden
} from '../../shared/types/cohort'

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

    // Build WHERE clause for search with hybrid strategy
    const whereConditions: string[] = []
    const params_array: (string | number)[] = []

    if (params.search_term !== undefined && params.search_term !== '') {
      const term = params.search_term.trim()

      // Pattern detection for search strategy
      const geneSymbolPattern = /^[A-Z][A-Z0-9]+$/i
      const genomicPosPattern = /^(?:chr)?(\d{1,2}|X|Y|MT?):(\d+)$/i
      const hgvsPattern = /^[cp]\./

      if (geneSymbolPattern.test(term)) {
        // Gene symbol search via FTS5
        // Escape FTS5 special characters by wrapping in double quotes
        let ftsQuery = term
        if (term.includes('-') || term.includes('*') || term.includes('"')) {
          // Escape internal quotes and wrap in quotes
          ftsQuery = `"${term.replace(/"/g, '""')}"`
        }
        // Append * for prefix matching
        ftsQuery = `${ftsQuery}*`
        whereConditions.push('id IN (SELECT rowid FROM variants_fts WHERE gene_symbol MATCH ?)')
        params_array.push(ftsQuery)
      } else if (genomicPosPattern.test(term)) {
        // Genomic position search (chr:pos)
        const match = term.match(genomicPosPattern)
        if (match !== null) {
          const chr = match[1] // Already normalized (no 'chr' prefix)
          const pos = parseInt(match[2], 10)
          whereConditions.push('chr = ? AND pos = ?')
          params_array.push(chr, pos)
        }
      } else if (hgvsPattern.test(term)) {
        // HGVS notation search
        const searchPattern = `%${term}%`
        whereConditions.push('(cdna LIKE ? OR aa_change LIKE ?)')
        params_array.push(searchPattern, searchPattern)
      } else {
        // Fallback: broad LIKE search
        const searchPattern = `%${term}%`
        whereConditions.push('(gene_symbol LIKE ? OR cdna LIKE ? OR aa_change LIKE ?)')
        params_array.push(searchPattern, searchPattern, searchPattern)
      }
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
      .prepare(
        'SELECT COUNT(DISTINCT gene_symbol) as count FROM variants WHERE gene_symbol IS NOT NULL'
      )
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
   * Get carriers for a specific variant
   *
   * Returns individual cases carrying the variant with case name and zygosity.
   *
   * @param chr - Chromosome
   * @param pos - Genomic position
   * @param ref - Reference allele
   * @param alt - Alternate allele
   * @returns Array of carriers with case ID, name, and genotype
   */
  getCarriers(chr: string, pos: number, ref: string, alt: string): CohortCarrier[] {
    const sql = `
      SELECT
        v.case_id,
        c.name as case_name,
        v.gt_num
      FROM variants v
      JOIN cases c ON v.case_id = c.id
      WHERE v.chr = ? AND v.pos = ? AND v.ref = ? AND v.alt = ?
      ORDER BY c.name
    `

    const stmt = this.getStatement(sql)
    return stmt.all(chr, pos, ref, alt) as CohortCarrier[]
  }

  /**
   * Get gene-level burden analysis
   *
   * Returns per-gene aggregation showing variant counts and affected case counts.
   *
   * @returns Array of gene burden data sorted by affected cases descending
   */
  getGeneBurden(): GeneBurden[] {
    const sql = `
      SELECT
        gene_symbol,
        COUNT(*) as variant_count,
        COUNT(DISTINCT chr || ':' || pos || ':' || ref || ':' || alt) as unique_variant_count,
        COUNT(DISTINCT case_id) as affected_case_count,
        (SELECT COUNT(*) FROM cases) as total_cases
      FROM variants
      WHERE gene_symbol IS NOT NULL AND gene_symbol != ''
      GROUP BY gene_symbol
      ORDER BY affected_case_count DESC, variant_count DESC
    `

    const stmt = this.getStatement(sql)
    return stmt.all() as GeneBurden[]
  }

  /**
   * Close and clear statement cache
   */
  close(): void {
    this.statementCache.clear()
  }
}
