import type { Database as DatabaseType } from 'better-sqlite3-multiple-ciphers'
import { sql, type Kysely } from 'kysely'
import type { VarlensDatabase } from '../../shared/types/database-schema'
import type { VariantFilter, SortItem } from './types'
import { mainLogger } from '../services/MainLogger'
import { buildVariantOrderTerms, type ResolvedVariantSort } from '../../shared/sql/chromosome-order'
import type { VariantSearchService } from './VariantSearchService'
import { applyAnnotationScopeFilters } from './variant-filter/annotation-scope-filters'
import {
  applyExtensionFiltersAndSortJoins,
  applyVariantTypeFilter,
  applyVariantTypeProjectionJoin,
  createBaseVariantQuery
} from './variant-filter/base-query-and-joins'
import { applyBareColumnFilters } from './variant-filter/column-filters'
import {
  applyAnnotationValueFilters,
  applyExactVariantMatch,
  applyInternalAfFilter,
  applyPanelIntervalFilter,
  applyScoreRangeFilters,
  applyTagFilter,
  countCasesForInternalAf,
  PANEL_TEMP_TABLE_THRESHOLD
} from './variant-filter/core-filters'
import { applyInheritanceFilters } from './variant-filter/inheritance-filters'
import type { VariantFilterBuildOptions, VariantQueryBuilder } from './variant-filter/query-types'
import { resolveSortColumn } from './variant-filter/sortable-columns'

export type { VariantQueryBuilder } from './variant-filter/query-types'
export {
  BASE_SORTABLE_COLUMNS,
  SORTABLE_COLUMNS,
  resolveSortColumn
} from './variant-filter/sortable-columns'

/**
 * Builds WHERE clause and ORDER BY for variant queries.
 *
 * `build()` is a thin, ordered pipeline over the domain steps in
 * `./variant-filter/` — each step takes the query plus the filter and
 * returns the updated query. The step order is the order of the emitted
 * JOINs, predicates and bound parameters, so it must not be rearranged.
 */
export class VariantFilterBuilder {
  constructor(
    private readonly db: DatabaseType,
    private readonly kysely: Kysely<VarlensDatabase>,
    private readonly searchService?: VariantSearchService
  ) {}

  /**
   * Build a Kysely SELECT query from a VariantFilter.
   * Used by both getVariants() and getAllVariantsForExport().
   *
   * The optional `sortBy` argument is used only to pre-compute extension
   * table JOINs that sort keys might require. The actual ORDER BY clauses
   * are still applied by `applySort()`. Passing sortBy here avoids needing
   * to add JOINs later (which would risk duplicating aliases).
   */
  build(filter: VariantFilter, options?: VariantFilterBuildOptions): VariantQueryBuilder {
    let query = createBaseVariantQuery(this.kysely, filter)
    const totalCaseCount = countCasesForInternalAf(this.db, this.kysely, filter)

    query = applyVariantTypeFilter(query, filter)
    query = applyVariantTypeProjectionJoin(query, filter)
    query = applyExtensionFiltersAndSortJoins(query, filter, options?.sortBy)
    query = applyAnnotationValueFilters(query, filter)
    query = applyScoreRangeFilters(query, filter)
    query = applyInternalAfFilter(query, filter, totalCaseCount)
    query = this.applySearch(query, filter)
    query = applyExactVariantMatch(query, filter)
    query = applyTagFilter(query, this.kysely, filter)
    query = applyPanelIntervalFilter(query, filter, options?.forceOrChain)
    query = applyAnnotationScopeFilters(query, this.kysely, filter)
    query = applyBareColumnFilters(query, filter)
    return applyInheritanceFilters(query, filter)
  }

  /** FTS5 search — a no-op when no search service was injected. */
  private applySearch(query: VariantQueryBuilder, filter: VariantFilter): VariantQueryBuilder {
    if (filter.search_query == null || filter.search_query === '') return query
    if (!this.searchService) return query
    return this.searchService.applySearchFilter(query, filter.search_query)
  }

  /**
   * Apply ORDER BY to a Kysely query using sql template literals
   * for NULLS FIRST/LAST support (not natively available in Kysely 0.28.x).
   *
   * Accepts both bare base column keys (e.g. `gnomad_af`) and dotted
   * extension keys (e.g. `cnv.copy_number`). For extension keys, the caller
   * MUST have passed `sortBy` to `build()` so the LEFT JOIN for the
   * referenced extension table is already present in the query; otherwise
   * the emitted ORDER BY will reference an unknown alias.
   */
  applySort(query: VariantQueryBuilder, sortBy?: SortItem[]): VariantQueryBuilder {
    const resolvedSorts: ResolvedVariantSort[] = []
    for (const sort of sortBy ?? []) {
      const resolved = resolveSortColumn(sort.key)
      if (resolved === null) {
        mainLogger.warn(`Invalid sort column rejected: ${sort.key}`, 'VariantFilterBuilder')
        continue
      }
      resolvedSorts.push({ key: sort.key, column: resolved.sql, order: sort.order })
    }
    // Natural chromosome order (1..22, X, Y, MT) via the shared chr-rank
    // expression; the default (chr, pos) order is served by
    // idx_variants_case_chr_rank. Columns come from BASE_SORTABLE_COLUMNS /
    // VARIANT_EXTENSION_REGISTRY (internally controlled), so sql.raw is safe.
    const terms = [...buildVariantOrderTerms(resolvedSorts, 'variants'), 'id ASC']
    return query.orderBy(sql.raw(terms.join(', ')))
  }

  // ── Panel interval temp table ────────────────────────────────

  /**
   * Populate a temp table with panel intervals for large interval sets (>= 50).
   * Must be called before build() when filter.panel_intervals.length >= 50.
   */
  setupPanelIntervalsTable(intervals: Array<{ chr: string; start: number; end: number }>): void {
    this.db.exec(
      'CREATE TEMP TABLE IF NOT EXISTS _panel_intervals (chr TEXT, start_pos INTEGER, end_pos INTEGER); ' +
        'CREATE INDEX IF NOT EXISTS _idx_panel_intervals ON _panel_intervals (chr, start_pos, end_pos); ' +
        'DELETE FROM _panel_intervals'
    )
    const insert = this.db.prepare(
      'INSERT INTO _panel_intervals (chr, start_pos, end_pos) VALUES (?, ?, ?)'
    )
    const insertMany = this.db.transaction(
      (items: Array<{ chr: string; start: number; end: number }>) => {
        for (const iv of items) insert.run(iv.chr, iv.start, iv.end)
      }
    )
    insertMany(intervals)
  }

  /**
   * Clean up the temp table after query execution.
   */
  cleanupPanelIntervalsTable(): void {
    this.db.exec('DROP INDEX IF EXISTS _idx_panel_intervals; DROP TABLE IF EXISTS _panel_intervals')
  }

  /**
   * If filter uses large panel intervals, set up temp table before query.
   * Returns true if temp table was created (caller should clean up after).
   */
  preparePanelIntervals(filter: VariantFilter): boolean {
    if (filter.panel_intervals && filter.panel_intervals.length >= PANEL_TEMP_TABLE_THRESHOLD) {
      this.setupPanelIntervalsTable(filter.panel_intervals)
      return true
    }
    return false
  }
}
