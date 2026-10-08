/**
 * CohortService - Aggregated variant analysis across all cases
 *
 * Reads from pre-computed cohort_variant_summary and gene_burden_summary tables.
 * Summary tables are populated by CohortSummaryService.rebuild() after import/delete.
 */

import { offeredFilterValues } from '../../shared/config/severity.config'
import type Database from 'better-sqlite3-multiple-ciphers'
import type { Statement } from 'better-sqlite3-multiple-ciphers'
import { mainLogger } from '../services/MainLogger'
import type {
  CohortVariant,
  CohortSummary,
  CohortSearchParams,
  CohortCarrier,
  GeneBurden,
  CohortPaginatedResult
} from '../../shared/types/cohort'
import type { ColumnFilterMeta, ColumnFiltersParam } from '../../shared/types/column-filters'
import { capCohortDistinctCount } from '../../shared/types/column-filters'
import { assertValidColumnFilterValues } from '../../shared/filters/column-filter-validation'
import { tokenize, parse } from '../../shared/utils/boolean-search'
import { emitCohortSearch, emitTerm } from './search/cohort-search-emitter'
import { buildBaseWhere, type BaseFilterInput } from './variant-where-builder'
import { buildExtensionExistsClauses } from './variant-extension-registry'
import { cohortOrderByClause } from '../../shared/sql/chromosome-order'
import { readUniqueVariantCount } from './cohort-unique-variant-count'
import { planSqliteCohortKeyset, SQLITE_KEYSET_EXTRA_COLUMNS } from './cohort-keyset-page'
import {
  COHORT_BUILD_TOTALS_JOIN,
  COHORT_FREQUENCY_SQL,
  COHORT_SUMMARY_WITH_FREQUENCY_FROM,
  cohortSortExpression
} from './cohort-frequency-sql'

// prettier-ignore
const SORTABLE_COLUMNS: Record<string, string> = {
  chr: 'chr', pos: 'pos', gene_symbol: 'gene_symbol', cdna: 'cdna', aa_change: 'aa_change',
  carrier_count: 'carrier_count', cohort_frequency: 'cohort_frequency', het_count: 'het_count',
  hom_count: 'hom_count', consequence: 'consequence', func: 'func', clinvar: 'clinvar',
  gnomad_af: 'gnomad_af', cadd_phred: 'cadd', transcript: 'transcript'
}

// prettier-ignore
const NUMERIC_COLUMNS = new Set(['pos', 'carrier_count', 'cohort_frequency', 'het_count', 'hom_count', 'gnomad_af', 'cadd_phred'])

/**
 * Rows of `cvs` overlapping any region of one JSON parameter, i.e.
 * `chr = c AND pos <= end AND COALESCE(end_pos, pos) >= start` (a spanning
 * SV/CNV that covers a region counts — parity with the PG cohort query).
 * Region-driven, in two index ranges per region: rows starting inside it, then
 * spanning rows that start before it (idx_cvs_end_pos). Seeking `pos <= end`
 * alone walks half a chromosome per region; an OR chain is no faster and
 * throws beyond ~1000 regions (expression depth, #491).
 */
export const COHORT_PANEL_INTERVAL_CONDITION = `cvs.rowid IN (
  WITH iv(chr, s, e) AS MATERIALIZED (
    SELECT value ->> 'chr', value ->> 'start', value ->> 'end' FROM json_each(?))
  SELECT pv.rowid FROM iv CROSS JOIN cohort_variant_summary pv
    WHERE pv.chr = iv.chr AND pv.pos BETWEEN iv.s AND iv.e AND COALESCE(pv.end_pos, pv.pos) >= iv.s
  UNION ALL
  SELECT pv.rowid FROM iv CROSS JOIN cohort_variant_summary pv
    WHERE pv.chr = iv.chr AND pv.end_pos >= iv.s AND pv.pos < iv.s)`

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
    needsBuildTotals: boolean
  } {
    const whereConditions: string[] = []
    const paramsArray: (string | number)[] = []

    // Search term handling with LIKE-based strategy
    if (params.search_term !== undefined && params.search_term !== '') {
      const term = params.search_term.trim()
      const hasBooleanOps = /\b(AND|OR|NOT)\b/.test(term)

      if (!hasBooleanOps) {
        const singleCondition = emitTerm(term, paramsArray)
        whereConditions.push(singleCondition)
      } else {
        const sqlCondition = this.buildBooleanSearchCondition(term, paramsArray)
        whereConditions.push(sqlCondition)
      }
    }

    // Panel interval filter (region-based, cohort-specific — not in buildBaseWhere)
    if (params.panel_intervals && params.panel_intervals.length > 0) {
      paramsArray.push(JSON.stringify(params.panel_intervals))
      whereConditions.push(COHORT_PANEL_INTERVAL_CONDITION)
    }

    // Validate against the caller's keys (before remapping, and covering the
    // dotted extension keys) so the error matches the PostgreSQL cohort path.
    assertValidColumnFilterValues(params.column_filters)

    // Remap column_filters keys through SORTABLE_COLUMNS to preserve the
    // existing alias mapping (e.g. 'cadd_phred' -> 'cadd') and the whitelist
    // behaviour. buildBaseWhere emits ${baseAlias}.${column} directly, so
    // unmapped keys would produce SQL referencing non-existent columns on
    // cohort_variant_summary.
    let remappedColumnFilters: ColumnFiltersParam | undefined
    if (params.column_filters !== undefined) {
      remappedColumnFilters = {}
      for (const [key, filter] of Object.entries(params.column_filters)) {
        const sqlColumn = SORTABLE_COLUMNS[key]
        if (sqlColumn === undefined) continue
        remappedColumnFilters[sqlColumn] = filter
      }
    }

    // Delegate base-field + bare-key column_filters translation to the
    // shared helper. Preserve the legacy > 0 / >= 0 guards on gnomad_af_max
    // and cadd_min at the call site — buildBaseWhere does not apply these
    // because they are caller-specific legacy semantics. Tests rely on
    // gnomad_af_max=0 being treated as a no-op.
    const baseInput: BaseFilterInput = {
      gnomad_af_max:
        params.gnomad_af_max !== undefined && params.gnomad_af_max > 0
          ? params.gnomad_af_max
          : undefined,
      cadd_min: params.cadd_min !== undefined && params.cadd_min >= 0 ? params.cadd_min : undefined,
      consequences: params.consequences,
      clinvars: params.clinvars,
      funcs: params.funcs,
      gene_symbol: params.gene_symbol,
      max_internal_af: params.max_internal_af,
      starred_only: params.starred_only,
      has_comment: params.has_comment,
      acmg_classifications: params.acmg_classifications,
      carrier_count_min: params.carrier_count_min,
      variant_type: params.variant_type,
      genome_build: params.genome_build,
      column_filters: remappedColumnFilters
    }

    const base = buildBaseWhere(baseInput, { baseAlias: 'cvs', scope: 'cohort-listing' })
    if (base.sql !== '') {
      whereConditions.push(base.sql)
      paramsArray.push(...base.params)
    }

    // Extension filter via EXISTS subquery (cvs has no variant_id, so we
    // correlate on chr/pos/ref/alt/variant_type back to variants + extension).
    // Uses params.column_filters (NOT the remapped version — extension keys
    // are dotted like 'cnv.copy_number' and don't need SORTABLE_COLUMNS
    // remapping; the remap would silently drop them).
    if (params.column_filters !== undefined) {
      const ext = buildExtensionExistsClauses(params.column_filters, 'cvs')
      if (ext.whereClause !== '') {
        whereConditions.push(ext.whereClause)
        paramsArray.push(...ext.params)
      }
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : ''
    return { whereClause, paramsArray, needsBuildTotals: base.needsBuildTotals }
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
    const sortBy = cohortSortExpression(
      validatedSortKey,
      SORTABLE_COLUMNS[validatedSortKey],
      params.genome_build
    )
    const sortOrder = params.sort_order ?? 'desc'

    // Total case count across builds (the `total_cases` column of every row)
    const totalCases = (
      this.db
        .prepare("SELECT COUNT(*) as count FROM cases WHERE import_status = 'ready'")
        .get() as {
        count: number
      }
    ).count

    if (totalCases === 0) {
      return { data: [], total_count: 0 }
    }

    const { whereClause, paramsArray, needsBuildTotals } = this.buildWhereClause(params)

    // Count query (only when filters change, not on page/sort change)
    let totalCount = 0
    if (params._count_needed !== false) {
      const countSql = `
        SELECT COUNT(*) as count
        FROM cohort_variant_summary cvs
        ${needsBuildTotals ? COHORT_BUILD_TOTALS_JOIN : ''}
        ${whereClause}
      `
      const countResult = this.db.prepare(countSql).get(...paramsArray) as { count: number }
      totalCount = countResult.count
    }

    // Build ORDER BY — use PK columns as tiebreaker instead of variant_key
    // Normalize at the sink rather than trusting sortOrder's upstream
    // 'asc' | 'desc' type — this is the cohort-view sink, so this ternary
    // also satisfies the cohort-parity requirement for S7.
    // Natural chromosome order in the tiebreaker (and for sort_by=chr) —
    // shared with both PostgreSQL cohort paths; see chromosome-order.ts.
    const direction = sortOrder === 'asc' ? 'asc' : 'desc'
    // Default carrier-count sort: keyset order (+ cursor seek), else OFFSET.
    const keyset = planSqliteCohortKeyset(params, validatedSortKey, direction)
    const orderByClause =
      keyset?.orderBy ?? cohortOrderByClause(validatedSortKey, sortBy, direction)
    const seekCondition =
      keyset !== null && keyset.seeking
        ? `${whereClause === '' ? 'WHERE' : 'AND'} ${keyset.seekCondition}`
        : ''

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
        ${COHORT_FREQUENCY_SQL} AS cohort_frequency,
        cvs.het_count,
        cvs.hom_count,
        cvs.variant_key,
        cvs.consequence,
        cvs.func,
        cvs.clinvar,
        cvs.gnomad_af,
        cvs.cadd AS cadd_phred,
        cvs.transcript,
        cvs.omim_mim_number AS omim_id${
          keyset !== null
            ? `,
        ${SQLITE_KEYSET_EXTRA_COLUMNS}`
            : ''
        }
      FROM ${COHORT_SUMMARY_WITH_FREQUENCY_FROM}
      ${whereClause}
      ${seekCondition}
      ${orderByClause}
      LIMIT ? OFFSET ?
    `

    const stmt = this.getStatement(sql)
    const seeking = keyset?.seeking === true
    const bound: unknown[] = [...paramsArray, limit, seeking ? 0 : offset]
    if (seeking && keyset !== null) bound.push(keyset.seekBindings)
    const results = stmt.all(...bound) as CohortVariant[]
    const paging = keyset?.finalize(results as unknown as Array<Record<string, unknown>>, limit)

    return {
      data: results,
      total_count: totalCount,
      ...paging
    }
  }

  /**
   * Build a SQL boolean expression from a search string containing AND/OR/NOT.
   */
  private buildBooleanSearchCondition(term: string, paramsArray: (string | number)[]): string {
    const tokens = tokenize(term)
    if (tokens.length === 0) return '1=1'
    let ast
    try {
      ast = parse(tokens)
    } catch (e) {
      mainLogger.warn(
        'Malformed boolean search expression, falling back to single-term: ' +
          (e instanceof Error ? e.message : String(e)),
        'CohortService'
      )
      return emitTerm(term, paramsArray)
    }
    const { sql, params } = emitCohortSearch(ast)
    paramsArray.push(...params)
    return sql
  }

  /**
   * Get cohort summary statistics
   */
  getCohortSummary(): CohortSummary {
    // Total cases
    const totalCases = (
      this.db
        .prepare("SELECT COUNT(*) as count FROM cases WHERE import_status = 'ready'")
        .get() as {
        count: number
      }
    ).count

    // Total variant observations of ready cases
    const totalVariants = (
      this.db
        .prepare(
          "SELECT COUNT(*) as count FROM variants v JOIN cases c ON c.id = v.case_id WHERE c.import_status = 'ready'"
        )
        .get() as { count: number }
    ).count

    // Unique variants: distinct (chr, pos, ref, alt), from the maintained exact counter.
    const uniqueVariants = readUniqueVariantCount(this.db)

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
        case 'Likely pathogenic':
          acmgCounts.likely_pathogenic = row.count
          break
        case 'Uncertain significance':
          acmgCounts.vus = row.count
          break
        case 'Likely benign':
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
      WHERE c.import_status = 'ready' AND v.chr = ? AND v.pos = ? AND v.ref = ? AND v.alt = ?
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
      SELECT gene_symbol, variant_count, unique_variant_count, affected_case_count,
        (SELECT COUNT(*) FROM cases WHERE import_status = 'ready') AS total_cases
      FROM gene_burden_summary
      ORDER BY affected_case_count DESC, variant_count DESC
    `
    const stmt = this.getStatement(sql)
    return stmt.all() as GeneBurden[]
  }

  /** Cached column metadata — invalidated on summary rebuild */
  private _columnMetaCache: ColumnFilterMeta[] | null = null
  /** `PRAGMA data_version` the cache was read at: it moves when another connection commits. */
  private _columnMetaDataVersion: unknown = null

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
    // DB worker threads are never told about an import or rebuild made by
    // another connection, so the cache checks for foreign commits itself.
    const dataVersion = this.db.pragma('data_version', { simple: true })
    if (this._columnMetaCache !== null && dataVersion === this._columnMetaDataVersion) {
      return this._columnMetaCache
    }

    const DISTINCT_THRESHOLD = 50
    // The frequency is derived, so the metadata reads through the build totals.
    const entries = Object.entries(SORTABLE_COLUMNS).map(([key, sqlCol]): [string, string] => [
      key,
      cohortSortExpression(key, sqlCol)
    ])

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
      .prepare(`SELECT ${selectParts.join(', ')} FROM ${COHORT_SUMMARY_WITH_FREQUENCY_FROM}`)
      .get() as Record<string, number | null>

    // Build metadata from aggregate results
    const meta: ColumnFilterMeta[] = []
    // Collect low-cardinality columns for UNION ALL distinct-value fetch
    const lowCardColumns: Array<{ key: string; sqlCol: string }> = []

    for (const [key, sqlCol] of entries) {
      const isNumeric = NUMERIC_COLUMNS.has(key)
      // Capped above the low-cardinality limit, as on PostgreSQL.
      const distinctCount = capCohortDistinctCount((aggRow[`cnt_${key}`] as number) ?? 0)

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
          `SELECT '${key}' AS col_key, CAST(${sqlCol} AS TEXT) AS val FROM ${COHORT_SUMMARY_WITH_FREQUENCY_FROM} WHERE ${sqlCol} IS NOT NULL GROUP BY ${sqlCol}`
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
          entry.distinctValues = offeredFilterValues(entry.key, values.sort())
        }
      }
    }

    this._columnMetaCache = meta
    this._columnMetaDataVersion = dataVersion
    return meta
  }

  /**
   * Close and clear statement cache
   */
  close(): void {
    this.statementCache.clear()
  }
}
