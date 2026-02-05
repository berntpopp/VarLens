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
  hom_count: 'hom_count',
  consequence: 'consequence',
  func: 'func',
  clinvar: 'clinvar',
  gnomad_af: 'gnomad_af',
  cadd_phred: 'cadd_phred'
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

    // Build WHERE clause for search and filters
    const whereConditions: string[] = []
    const params_array: (string | number)[] = []

    // Search term handling with hybrid strategy
    if (params.search_term !== undefined && params.search_term !== '') {
      const term = params.search_term.trim()
      const hasBooleanOps = /\b(AND|OR|NOT)\b/.test(term)

      if (!hasBooleanOps) {
        // Single-term search — detect type and use best strategy
        const singleCondition = this.buildSingleTermCondition(term, params_array)
        whereConditions.push(singleCondition)
      } else {
        // Multi-term boolean search — split on AND/OR/NOT, classify each token,
        // build SQL-level boolean combining FTS5 and LIKE conditions
        const sqlCondition = this.buildBooleanSearchCondition(term, params_array)
        whereConditions.push(sqlCondition)
      }
    }

    // Gene symbol filter (exact match)
    if (params.gene_symbol !== undefined && params.gene_symbol !== '') {
      whereConditions.push('gene_symbol = ?')
      params_array.push(params.gene_symbol)
    }

    // Consequence/Impact filter (IN clause)
    if (params.consequences !== undefined && params.consequences.length > 0) {
      const placeholders = params.consequences.map(() => '?').join(', ')
      whereConditions.push(`consequence IN (${placeholders})`)
      params_array.push(...params.consequences)
    }

    // Func filter (IN clause)
    if (params.funcs !== undefined && params.funcs.length > 0) {
      const placeholders = params.funcs.map(() => '?').join(', ')
      whereConditions.push(`func IN (${placeholders})`)
      params_array.push(...params.funcs)
    }

    // ClinVar filter (IN clause with LIKE for partial matches)
    if (params.clinvars !== undefined && params.clinvars.length > 0) {
      const clinvarConditions = params.clinvars.map(() => 'clinvar LIKE ?').join(' OR ')
      whereConditions.push(`(${clinvarConditions})`)
      params_array.push(...params.clinvars.map((c) => `%${c}%`))
    }

    // gnomAD AF max filter
    if (params.gnomad_af_max !== undefined && params.gnomad_af_max > 0) {
      whereConditions.push('(gnomad_af IS NULL OR gnomad_af <= ?)')
      params_array.push(params.gnomad_af_max)
    }

    // CADD min filter (>= 0 allows filtering for any non-null CADD score)
    if (params.cadd_min !== undefined && params.cadd_min >= 0) {
      whereConditions.push('cadd >= ?')
      params_array.push(params.cadd_min)
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : ''

    // Build HAVING clause for aggregate filters (applied after GROUP BY)
    const havingConditions: string[] = []
    const havingParams: number[] = []

    if (params.carrier_count_min !== undefined && params.carrier_count_min > 0) {
      havingConditions.push('COUNT(*) >= ?')
      havingParams.push(params.carrier_count_min)
    }

    if (params.cohort_frequency_min !== undefined && params.cohort_frequency_min > 0) {
      havingConditions.push(`CAST(COUNT(*) AS REAL) / ${totalCases} >= ?`)
      havingParams.push(params.cohort_frequency_min)
    }

    const havingClause =
      havingConditions.length > 0 ? `HAVING ${havingConditions.join(' AND ')}` : ''

    // Build ORDER BY clause
    let orderByClause = 'ORDER BY carrier_count DESC, pos ASC'
    if (sortBy !== undefined) {
      const direction = sortOrder.toUpperCase()
      orderByClause = `ORDER BY ${sortBy} ${direction}, pos ASC`
    }

    // Main aggregation query — uses CTE to deduplicate per case before counting
    // Includes annotation columns (MAX to get representative value)
    const sql = `
      WITH deduped AS (
        SELECT
          chr, pos, ref, alt, case_id,
          MAX(gene_symbol) as gene_symbol,
          MAX(cdna) as cdna,
          MAX(aa_change) as aa_change,
          MAX(gt_num) as gt_num,
          MAX(consequence) as consequence,
          MAX(func) as func,
          MAX(clinvar) as clinvar,
          MAX(gnomad_af) as gnomad_af,
          MAX(cadd) as cadd,
          MAX(transcript) as transcript,
          MAX(omim_mim_number) as omim_id
        FROM variants
        ${whereClause}
        GROUP BY chr, pos, ref, alt, case_id
      )
      SELECT
        chr,
        pos,
        ref,
        alt,
        MAX(gene_symbol) as gene_symbol,
        MAX(cdna) as cdna,
        MAX(aa_change) as aa_change,
        COUNT(*) as carrier_count,
        ${totalCases} as total_cases,
        CAST(COUNT(*) AS REAL) / ${totalCases} as cohort_frequency,
        SUM(CASE WHEN gt_num IN ('0/1', '1/0', '0|1', '1|0') THEN 1 ELSE 0 END) as het_count,
        SUM(CASE WHEN gt_num IN ('1/1', '1|1') THEN 1 ELSE 0 END) as hom_count,
        chr || ':' || pos || ':' || ref || ':' || alt as variant_key,
        MAX(consequence) as consequence,
        MAX(func) as func,
        MAX(clinvar) as clinvar,
        MAX(gnomad_af) as gnomad_af,
        MAX(cadd) as cadd_phred,
        MAX(transcript) as transcript,
        MAX(omim_id) as omim_id
      FROM deduped
      GROUP BY chr, pos, ref, alt
      ${havingClause}
      ${orderByClause}
      LIMIT ? OFFSET ?
    `

    const stmt = this.getStatement(sql)
    const results = stmt.all(...params_array, ...havingParams, limit, offset) as CohortVariant[]

    // Get total count (same query without LIMIT/OFFSET, includes HAVING for cohort filters)
    const countSql = `
      SELECT COUNT(*) as count
      FROM (
        SELECT chr, pos, ref, alt
        FROM variants
        ${whereClause}
        GROUP BY chr, pos, ref, alt
        ${havingClause}
      )
    `

    const countStmt = this.getStatement(countSql)
    const countResult = countStmt.get(...params_array, ...havingParams) as { count: number }
    const totalCount = countResult.count

    return {
      data: results,
      total_count: totalCount
    }
  }

  /**
   * Build a SQL condition for a single search token.
   * Detects genomic position, HGVS, or gene/text and returns the appropriate WHERE fragment.
   */
  private buildSingleTermCondition(token: string, params_array: (string | number)[]): string {
    const genomicPosPattern = /^(?:chr)?(\d{1,2}|X|Y|MT?):(\d+)$/i
    const hgvsPattern = /^[cp]\./

    if (genomicPosPattern.test(token)) {
      const match = token.match(genomicPosPattern)
      if (match !== null) {
        params_array.push(match[1], parseInt(match[2], 10))
        return '(chr = ? AND pos = ?)'
      }
    }

    if (hgvsPattern.test(token)) {
      const searchPattern = `%${token}%`
      params_array.push(searchPattern, searchPattern)
      return '(cdna LIKE ? OR aa_change LIKE ?)'
    }

    // Default: FTS5 for gene symbol / consequence / general text
    const ftsQuery = `"${token.replace(/"/g, '""')}"*`
    params_array.push(ftsQuery)
    return 'id IN (SELECT rowid FROM variants_fts WHERE variants_fts MATCH ?)'
  }

  /**
   * Build a SQL boolean expression from a search string containing AND/OR/NOT.
   * Each token is classified independently (FTS5 for genes, LIKE for HGVS, etc.)
   * and combined with SQL AND/OR/NOT at the WHERE level.
   */
  private buildBooleanSearchCondition(term: string, params_array: (string | number)[]): string {
    // Split preserving operators as separate tokens
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
        // Classify and build condition for this token
        sqlParts.push(this.buildSingleTermCondition(part, params_array))
      }
    }

    return `(${sqlParts.join(' ')})`
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
