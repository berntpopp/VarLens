import { BaseRepository } from './BaseRepository'
import type { CaseRepository } from './CaseRepository'
import type { Database as DatabaseType } from 'better-sqlite3-multiple-ciphers'
import type { Kysely } from 'kysely'
import type { VarlensDatabase } from '../../shared/types/database-schema'
import type { Variant, VariantFilter, PaginatedResult, SortItem } from './types'
import type { FilterOptions } from '../../shared/types/api'
import type { ColumnFilterMeta } from '../../shared/types/column-filters'
import type { TranscriptInsertRow } from '../../shared/types/transcript'
import type {
  SvExtensionRow,
  CnvExtensionRow,
  StrExtensionRow
} from '../import/vcf/extension-parsers'
import {
  tearDownFtsTriggers,
  restoreFtsTriggers,
  rebuildAllFtsIndexes,
  type TriggerSnapshot
} from './fts-trigger-management'
import { mainLogger } from '../services/MainLogger'

/** Extended variant fields for multi-type import (SV/CNV/STR) */
interface VariantExtensionFields {
  variant_type?: string
  end_pos?: number | null
  sv_type?: string | null
  sv_length?: number | null
  caller?: string | null
  _sv?: SvExtensionRow
  _cnv?: CnvExtensionRow
  _str?: StrExtensionRow
}

import { DATABASE_CONFIG } from '../../shared/config'
import { VariantFilterBuilder, BASE_SORTABLE_COLUMNS } from './VariantFilterBuilder'
import { VariantSearchService } from './VariantSearchService'
import { VariantFrequencyService } from './VariantFrequencyService'
import { isExtensionColumnKey, resolveExtensionColumnKey } from './variant-extension-registry'

const BATCH_SIZE = DATABASE_CONFIG.BATCH_INSERT_SIZE

const NUMERIC_COLUMNS = new Set(['pos', 'gnomad_af', 'cadd', 'qual', 'hpo_sim_score'])

/** Columns that are computed at query time (not physical table columns) -- excluded from getAllColumnMetas */
const COMPUTED_COLUMNS = new Set(['internal_af'])

export class VariantRepository extends BaseRepository {
  private cases: CaseRepository
  private readonly filterBuilder: VariantFilterBuilder
  private readonly searchService: VariantSearchService
  private readonly frequencyService: VariantFrequencyService
  private ftsSnapshot: TriggerSnapshot = {}

  constructor(db: DatabaseType, kysely: Kysely<VarlensDatabase>, cases: CaseRepository) {
    super(db, kysely)
    this.cases = cases
    this.searchService = new VariantSearchService(db, kysely)
    this.filterBuilder = new VariantFilterBuilder(db, kysely, this.searchService)
    this.frequencyService = new VariantFrequencyService(db)
  }

  /**
   * Drop FTS triggers to avoid per-row overhead before a bulk insert session.
   * Must be paired with a subsequent call to `finishBulkInsert()`.
   */
  beginBulkInsert(): void {
    this.ftsSnapshot = tearDownFtsTriggers(this.db)
  }

  /**
   * Insert a single batch of variants inside a transaction.
   * Call `beginBulkInsert()` before and `finishBulkInsert()` after all batches.
   * Does not update case variant_count — that is done in `finishBulkInsert()`.
   */
  insertBatch(
    variants: (Omit<Variant, 'id' | 'case_id'> &
      VariantExtensionFields & { _transcripts?: TranscriptInsertRow[] })[],
    caseId: number
  ): void {
    const runTransaction = this.db.transaction(
      (
        batch: (Omit<Variant, 'id' | 'case_id'> &
          VariantExtensionFields & { _transcripts?: TranscriptInsertRow[] })[]
      ) => {
        for (const v of batch) {
          const result = this.execRun(
            this.kysely.insertInto('variants').values({
              case_id: caseId,
              chr: v.chr,
              pos: v.pos,
              ref: v.ref,
              alt: v.alt,
              gene_symbol: v.gene_symbol,
              omim_mim_number: v.omim_mim_number,
              consequence: v.consequence,
              gnomad_af: v.gnomad_af,
              cadd: v.cadd,
              clinvar: v.clinvar,
              gt_num: v.gt_num,
              func: v.func,
              qual: v.qual,
              hpo_sim_score: v.hpo_sim_score,
              transcript: v.transcript,
              cdna: v.cdna,
              aa_change: v.aa_change,
              moi: v.moi,
              gq: v.gq ?? null,
              dp: v.dp ?? null,
              ad_ref: v.ad_ref ?? null,
              ad_alt: v.ad_alt ?? null,
              ab: v.ab ?? null,
              filter: v.filter ?? null,
              info_json: v.info_json ?? null,
              source_format: v.source_format ?? null,
              variant_type: v.variant_type ?? 'snv',
              end_pos: v.end_pos ?? null,
              sv_type: v.sv_type ?? null,
              sv_length: v.sv_length ?? null,
              caller: v.caller ?? null
            })
          )

          const variantId = result.lastInsertRowid as number
          if (v._transcripts !== undefined && v._transcripts.length > 0) {
            for (const t of v._transcripts) {
              this.execRun(
                this.kysely.insertInto('variant_transcripts').values({
                  variant_id: variantId,
                  transcript_id: t.transcript_id,
                  gene_symbol: t.gene_symbol,
                  consequence: t.consequence,
                  func: t.func,
                  cdna: t.cdna,
                  aa_change: t.aa_change,
                  hpo_sim_score: t.hpo_sim_score,
                  moi: t.moi,
                  is_selected: t.is_selected
                })
              )
            }
          }

          // Insert extension table row if present
          if (v._sv !== undefined) {
            this.execRun(
              this.kysely.insertInto('variant_sv').values({
                variant_id: variantId,
                ...v._sv
              })
            )
          } else if (v._cnv !== undefined) {
            this.execRun(
              this.kysely.insertInto('variant_cnv').values({
                variant_id: variantId,
                ...v._cnv
              })
            )
          } else if (v._str !== undefined) {
            this.execRun(
              this.kysely.insertInto('variant_str').values({
                variant_id: variantId,
                ...v._str
              })
            )
          }
        }
      }
    )

    for (let i = 0; i < variants.length; i += BATCH_SIZE) {
      runTransaction(variants.slice(i, i + BATCH_SIZE))
    }
  }

  /**
   * Rebuild FTS, recreate triggers, run ANALYZE and optimize. Does NOT update
   * the case's variant_count — callers that need it updated should use
   * `finishBulkInsert()` (for single-file imports) or call
   * `recalculateCaseVariantCount()` afterwards (for multi-file sessions where
   * the final count is the sum across all appended files).
   */
  finishBulkInsertNoCount(): void {
    // Always rebuild FTS and restore triggers, even if a step fails
    try {
      rebuildAllFtsIndexes(this.db)
    } catch (error) {
      mainLogger.error(`Failed to rebuild FTS index: ${error}`, 'VariantRepository')
    }

    try {
      restoreFtsTriggers(this.db, this.ftsSnapshot)
      this.ftsSnapshot = {}
    } catch (error) {
      mainLogger.error(`Failed to recreate FTS triggers: ${error}`, 'VariantRepository')
    }

    // Update query planner statistics after bulk import
    try {
      this.db.exec('ANALYZE')
    } catch (error) {
      mainLogger.error(`Failed to run ANALYZE: ${error}`, 'VariantRepository')
    }

    // Optimize FTS5 index after bulk import
    try {
      this.db.exec("INSERT INTO variants_fts(variants_fts) VALUES('optimize')")
    } catch (error) {
      mainLogger.error(`Failed to optimize FTS index: ${error}`, 'VariantRepository')
    }
  }

  /**
   * Rebuild FTS, recreate triggers, update case variant_count, run ANALYZE and optimize.
   * Call this once after all `insertBatch()` calls to complete a bulk insert session.
   */
  finishBulkInsert(caseId: number, totalInserted: number): void {
    this.cases.updateCaseVariantCount(caseId, totalInserted)
    this.finishBulkInsertNoCount()
  }

  /**
   * Recompute a case's variant_count from the variants table and write it back
   * in a single atomic UPDATE. Used after multi-file import sessions where the
   * final count should reflect all appended files, and is resilient to any
   * ordering between per-file inserts and a final variant_count refresh.
   */
  recalculateCaseVariantCount(caseId: number): void {
    this.db
      .prepare(
        `UPDATE cases SET variant_count = (
          SELECT COUNT(*) FROM variants WHERE case_id = ?
        ) WHERE id = ?`
      )
      .run(caseId, caseId)
  }

  /**
   * Convenience method: drop FTS triggers, insert all variants in batches,
   * then rebuild FTS and restore triggers in a single call.
   *
   * For large imports with multiple logical batches, prefer calling
   * `beginBulkInsert()`, then `insertBatch()` per batch, then `finishBulkInsert()`
   * so that FTS is rebuilt only once.
   */
  insertVariantsBatch(
    caseId: number,
    variants: (Omit<Variant, 'id' | 'case_id'> &
      VariantExtensionFields & { _transcripts?: TranscriptInsertRow[] })[]
  ): number {
    this.cases.getCase(caseId)

    this.beginBulkInsert()

    try {
      this.insertBatch(variants, caseId)
    } finally {
      this.finishBulkInsert(caseId, variants.length)
    }

    return variants.length
  }

  /**
   * Lightweight check for whether variants use 'chr' prefix (e.g. 'chr1' vs '1').
   * Only fetches a single row instead of loading full variant data.
   */
  getChrPrefix(caseId: number): boolean {
    const row = this.db
      .prepare('SELECT chr FROM variants WHERE case_id = ? LIMIT 1')
      .get(caseId) as { chr: string } | undefined
    return row?.chr?.startsWith('chr') ?? false
  }

  getVariantCount(caseId: number): number {
    const result = this.execFirst<{ count: number }>(
      this.kysely
        .selectFrom('variants')
        .select(({ fn }) => fn.countAll<number>().as('count'))
        .where('case_id', '=', caseId)
    )
    return result?.count ?? 0
  }

  /**
   * Get variant counts grouped by variant_type for a case.
   * Used for variant type tab badges in the case view.
   *
   * Returns a map like: { snv: 1234, indel: 56, sv: 12, cnv: 3, str: 7 }
   * Missing types are not included in the returned record.
   */
  getVariantTypeCounts(caseId: number): Record<string, number> {
    const rows = this.execAll<{ variant_type: string; count: number }>(
      this.kysely
        .selectFrom('variants')
        .select(['variant_type'])
        .select(({ fn }) => fn.countAll<number>().as('count'))
        .where('case_id', '=', caseId)
        .groupBy('variant_type')
    )

    const counts: Record<string, number> = {}
    for (const row of rows) {
      counts[row.variant_type] = row.count
    }
    return counts
  }

  // ── Query methods ────────────────────────────────────────────

  getVariants(
    filter: VariantFilter,
    limit: number,
    offset: number = 0,
    sortBy?: SortItem[],
    skipCount?: boolean,
    includeUnfilteredCount?: boolean
  ): PaginatedResult<Variant> & { unfiltered_count?: number } {
    const useTempTable = this.filterBuilder.preparePanelIntervals(filter)
    try {
      let total_count = 0

      if (skipCount !== true) {
        // Build count query using Kysely — avoids brittle string replacement
        const countQuery = this.filterBuilder.build(filter)
        const compiled = countQuery.compile()
        // Wrap the filtered query in a COUNT to handle complex WHERE clauses
        const countSql = `SELECT count(*) as count FROM (${compiled.sql})`
        const countResult = this.db.prepare(countSql).get(...compiled.parameters) as {
          count: number
        }
        total_count = countResult.count
      }

      // Data query with sort + pagination.
      // Pass sortBy into build() so extension sort keys (e.g. 'sv.support')
      // trigger the required LEFT JOIN before applySort references the alias.
      const dataQuery = this.filterBuilder.build(filter, { sortBy })
      const sortedQuery = this.filterBuilder
        .applySort(dataQuery, sortBy)
        .limit(limit)
        .offset(offset)
      const data = this.execAll<Variant>(sortedQuery)

      let unfiltered_count: number | undefined
      if (includeUnfilteredCount === true) {
        const result = this.db
          .prepare('SELECT COUNT(*) as count FROM variants WHERE case_id = ?')
          .get(filter.case_id) as { count: number }
        unfiltered_count = result.count
      }

      return {
        data,
        total_count,
        ...(unfiltered_count !== undefined ? { unfiltered_count } : {})
      }
    } finally {
      if (useTempTable) this.filterBuilder.cleanupPanelIntervalsTable()
    }
  }

  // ── Search delegators ───────────────────────────────────────

  searchVariants(caseId: number, query: string, limit?: number): Variant[] {
    return this.searchService.searchVariants(caseId, query, limit)
  }

  getGeneSymbols(caseId: number, query: string, limit?: number): string[] {
    return this.searchService.getGeneSymbols(caseId, query, limit)
  }

  // ── Export / count methods ──────────────────────────────────

  getAllVariantsForExport(filter: VariantFilter): Variant[] {
    const useTempTable = this.filterBuilder.preparePanelIntervals(filter)
    try {
      const query = this.filterBuilder.build(filter).orderBy('chr', 'asc').orderBy('pos', 'asc')
      return this.execAll<Variant>(query)
    } finally {
      if (useTempTable) this.filterBuilder.cleanupPanelIntervalsTable()
    }
  }

  /**
   * Count variants matching export filter without loading data.
   * Used to enforce hard limit before spawning export worker.
   */
  getExportCount(filter: VariantFilter): number {
    const useTempTable = this.filterBuilder.preparePanelIntervals(filter)
    try {
      const compiled = this.filterBuilder.build(filter).compile()
      const countSql = `SELECT count(*) as count FROM (${compiled.sql})`
      const result = this.db.prepare(countSql).get(...compiled.parameters) as { count: number }
      return result.count
    } finally {
      if (useTempTable) this.filterBuilder.cleanupPanelIntervalsTable()
    }
  }

  /**
   * Return the count of variants matching a filter without fetching any data rows.
   * Useful for count-only checks (e.g. enforcing limits before an operation).
   */
  getFilteredCount(filter: VariantFilter): number {
    const useTempTable = this.filterBuilder.preparePanelIntervals(filter)
    try {
      const countQuery = this.filterBuilder.build(filter)
      const compiled = countQuery.compile()
      const countSql = `SELECT count(*) as count FROM (${compiled.sql})`
      const countResult = this.db.prepare(countSql).get(...compiled.parameters) as {
        count: number
      }
      return countResult.count
    } finally {
      if (useTempTable) this.filterBuilder.cleanupPanelIntervalsTable()
    }
  }

  /**
   * Compile the export query to SQL+params for worker thread execution.
   * The worker receives compiled SQL and runs it directly, avoiding
   * filter logic duplication.
   */
  compileExportQuery(
    filter: VariantFilter,
    limit: number
  ): { sql: string; parameters: readonly unknown[] } {
    // Force OR chain for compiled queries — temp tables don't transfer to worker threads
    const query = this.filterBuilder
      .build(filter, { forceOrChain: true })
      .orderBy('chr', 'asc')
      .orderBy('pos', 'asc')
      .limit(limit)
    return query.compile()
  }

  /**
   * Gather per-column metadata for ALL base columns in a single case scan.
   *
   * Consolidated aggregate query (COUNT DISTINCT + MIN/MAX for numerics) plus
   * one UNION ALL distinct-values pull for low-cardinality columns. Used by
   * `getFilterOptions` to populate the legacy full-metadata response.
   *
   * For per-column on-demand fetches (including extension columns) use the
   * scope-aware public `getColumnMeta(scope, columnKey)` below instead.
   */
  private getAllColumnMetas(caseId: number): ColumnFilterMeta[] {
    const DISTINCT_THRESHOLD = 50
    // Exclude computed columns (e.g. internal_af) which don't exist as physical table columns
    const columns = Object.entries(BASE_SORTABLE_COLUMNS).filter(
      ([key]) => !COMPUTED_COLUMNS.has(key)
    )

    // Query 1: Single scan — COUNT(DISTINCT col) for all columns + MIN/MAX for numeric columns
    const selectParts: string[] = []
    for (const [key, sqlCol] of columns) {
      selectParts.push(`COUNT(DISTINCT "${sqlCol}") AS "cnt_${key}"`)
      if (NUMERIC_COLUMNS.has(key)) {
        selectParts.push(`MIN("${sqlCol}") AS "min_${key}"`)
        selectParts.push(`MAX("${sqlCol}") AS "max_${key}"`)
      }
    }
    const aggSql = `SELECT ${selectParts.join(', ')} FROM variants WHERE case_id = ?`
    const aggRow = this.db.prepare(aggSql).get(caseId) as Record<string, number | null>

    // Build initial meta entries from aggregate results
    const meta: ColumnFilterMeta[] = []
    const lowCardinalityColumns: [string, string][] = []

    for (const [key, sqlCol] of columns) {
      const isNumeric = NUMERIC_COLUMNS.has(key)
      const distinctCount = (aggRow[`cnt_${key}`] as number) ?? 0

      const entry: ColumnFilterMeta = {
        key,
        dataType: isNumeric ? 'numeric' : 'text',
        distinctCount
      }

      if (isNumeric) {
        const minVal = aggRow[`min_${key}`]
        const maxVal = aggRow[`max_${key}`]
        entry.min = minVal ?? undefined
        entry.max = maxVal ?? undefined
      }

      if (distinctCount > 0 && distinctCount <= DISTINCT_THRESHOLD) {
        lowCardinalityColumns.push([key, sqlCol])
      }

      meta.push(entry)
    }

    // Query 2: UNION ALL for distinct values of all low-cardinality columns
    if (lowCardinalityColumns.length > 0) {
      // SAFETY: sqlCol values come from hardcoded BASE_SORTABLE_COLUMNS constant
      const unionParts = lowCardinalityColumns.map(
        ([key, sqlCol]) =>
          `SELECT '${key}' AS col_key, CAST("${sqlCol}" AS TEXT) AS val FROM variants WHERE case_id = ? AND "${sqlCol}" IS NOT NULL GROUP BY "${sqlCol}"`
      )
      const unionSql = unionParts.join(' UNION ALL ')
      const params = lowCardinalityColumns.map(() => caseId)
      const rows = this.db.prepare(unionSql).all(...params) as {
        col_key: string
        val: string
      }[]

      // Group results by column key
      const valuesByKey = new Map<string, string[]>()
      for (const row of rows) {
        let arr = valuesByKey.get(row.col_key)
        if (arr === undefined) {
          arr = []
          valuesByKey.set(row.col_key, arr)
        }
        arr.push(row.val)
      }

      // Attach sorted distinct values to corresponding meta entries
      for (const entry of meta) {
        const values = valuesByKey.get(entry.key)
        if (values !== undefined) {
          entry.distinctValues = values.sort((a, b) => a.localeCompare(b))
        }
      }
    }

    return meta
  }

  // ── Scope-aware single-column metadata (base + extension) ────

  /**
   * Fetch metadata for a single column, scoped to one case or a set of cases.
   *
   * Dispatches between base-column and extension-column paths based on
   * whether `columnKey` contains a dot (e.g. `cnv.copy_number` → extension,
   * `gnomad_af` → base).
   *
   * Used by on-demand IPC handlers that populate the per-column filter UI
   * lazily (Task 8). `getAllColumnMetas` remains the bulk path used by
   * `getFilterOptions` for the initial variant-type-switch render.
   */
  getColumnMeta(
    scope: { caseId: number } | { caseIds: number[] },
    columnKey: string
  ): ColumnFilterMeta {
    if (isExtensionColumnKey(columnKey)) {
      return this.getExtensionColumnMeta(scope, columnKey)
    }
    return this.getBaseColumnMeta(scope, columnKey)
  }

  /**
   * Per-column metadata aggregation for a single base column.
   *
   * Mirrors the single-column slice of `getAllColumnMetas` but scoped to an
   * arbitrary case set (cohort path) rather than always a single case.
   */
  private getBaseColumnMeta(
    scope: { caseId: number } | { caseIds: number[] },
    columnKey: string
  ): ColumnFilterMeta {
    const sqlCol = BASE_SORTABLE_COLUMNS[columnKey]
    if (sqlCol === undefined || COMPUTED_COLUMNS.has(columnKey)) {
      return { key: columnKey, dataType: 'text', distinctCount: 0 }
    }

    const DISTINCT_THRESHOLD = 50
    const isNumeric = NUMERIC_COLUMNS.has(columnKey)
    const caseIds = 'caseId' in scope ? [scope.caseId] : scope.caseIds
    if (caseIds.length === 0) {
      return {
        key: columnKey,
        dataType: isNumeric ? 'numeric' : 'text',
        distinctCount: 0
      }
    }
    const placeholders = caseIds.map(() => '?').join(', ')

    const aggParts = [`COUNT(DISTINCT "${sqlCol}") AS distinctCount`]
    if (isNumeric) {
      aggParts.push(`MIN("${sqlCol}") AS min`, `MAX("${sqlCol}") AS max`)
    }
    const aggSql = `SELECT ${aggParts.join(', ')} FROM variants WHERE case_id IN (${placeholders})`
    const aggRow = this.db.prepare(aggSql).get(...caseIds) as {
      distinctCount: number | null
      min?: number | null
      max?: number | null
    }

    const entry: ColumnFilterMeta = {
      key: columnKey,
      dataType: isNumeric ? 'numeric' : 'text',
      distinctCount: aggRow.distinctCount ?? 0
    }
    if (isNumeric) {
      entry.min = aggRow.min ?? undefined
      entry.max = aggRow.max ?? undefined
    }

    if (entry.distinctCount > 0 && entry.distinctCount <= DISTINCT_THRESHOLD) {
      // SAFETY: sqlCol comes from hardcoded BASE_SORTABLE_COLUMNS
      const valRows = this.db
        .prepare(
          `SELECT DISTINCT CAST("${sqlCol}" AS TEXT) AS v
           FROM variants
           WHERE case_id IN (${placeholders}) AND "${sqlCol}" IS NOT NULL
           ORDER BY "${sqlCol}"`
        )
        .all(...caseIds) as { v: string }[]
      entry.distinctValues = valRows.map((r) => r.v)
    }

    return entry
  }

  /**
   * Per-column metadata aggregation for a single extension column (e.g.
   * `cnv.copy_number`, `sv.support`, `str.disease`).
   *
   * Runs against the extension table (variant_sv / variant_cnv / variant_str)
   * joined back through variant_id → variants.case_id IN (...). For number
   * kinds, returns min/max; for text/enum kinds, returns distinctValues when
   * below the cardinality threshold.
   *
   * SAFETY: `def.table` and `column` come from the registry (never user
   * input), so interpolating them into the SQL string is safe.
   */
  private getExtensionColumnMeta(
    scope: { caseId: number } | { caseIds: number[] },
    columnKey: string
  ): ColumnFilterMeta {
    const resolved = resolveExtensionColumnKey(columnKey)
    if (resolved === null) {
      return { key: columnKey, dataType: 'text', distinctCount: 0 }
    }
    const DISTINCT_THRESHOLD = 50
    const { def, column, columnDef } = resolved
    const caseIds = 'caseId' in scope ? [scope.caseId] : scope.caseIds
    if (caseIds.length === 0) {
      return {
        key: columnKey,
        dataType: columnDef.kind === 'number' ? 'numeric' : 'text',
        distinctCount: 0
      }
    }
    const placeholders = caseIds.map(() => '?').join(', ')

    if (columnDef.kind === 'number') {
      const row = this.db
        .prepare(
          `SELECT MIN("${column}") AS min, MAX("${column}") AS max, COUNT(DISTINCT "${column}") AS distinctCount
           FROM ${def.table}
           WHERE variant_id IN (SELECT id FROM variants WHERE case_id IN (${placeholders}))`
        )
        .get(...caseIds) as { min: number | null; max: number | null; distinctCount: number }
      return {
        key: columnKey,
        dataType: 'numeric',
        distinctCount: row.distinctCount ?? 0,
        min: row.min ?? undefined,
        max: row.max ?? undefined
      }
    }

    const countRow = this.db
      .prepare(
        `SELECT COUNT(DISTINCT "${column}") AS distinctCount
         FROM ${def.table}
         WHERE variant_id IN (SELECT id FROM variants WHERE case_id IN (${placeholders}))`
      )
      .get(...caseIds) as { distinctCount: number }

    const entry: ColumnFilterMeta = {
      key: columnKey,
      dataType: 'text',
      distinctCount: countRow.distinctCount ?? 0
    }

    if (entry.distinctCount > 0 && entry.distinctCount <= DISTINCT_THRESHOLD) {
      const valRows = this.db
        .prepare(
          `SELECT DISTINCT "${column}" AS v
           FROM ${def.table}
           WHERE variant_id IN (SELECT id FROM variants WHERE case_id IN (${placeholders}))
             AND "${column}" IS NOT NULL
           ORDER BY "${column}"`
        )
        .all(...caseIds) as { v: string | number | null }[]
      entry.distinctValues = valRows.map((r) => String(r.v))
    }

    return entry
  }

  /**
   * Return the set of distinct `variant_type` values present in the given
   * scope. Used by the renderer to auto-hide variant-type tabs that have
   * zero rows (e.g. a SNV-only case hides the SV/CNV/STR tabs).
   */
  getVariantTypesPresent(scope: { caseId: number } | { caseIds: number[] }): Set<string> {
    const caseIds = 'caseId' in scope ? [scope.caseId] : scope.caseIds
    if (caseIds.length === 0) return new Set()
    const placeholders = caseIds.map(() => '?').join(', ')
    const rows = this.db
      .prepare(
        `SELECT DISTINCT variant_type FROM variants WHERE case_id IN (${placeholders}) AND variant_type IS NOT NULL`
      )
      .all(...caseIds) as { variant_type: string }[]
    return new Set(rows.map((r) => r.variant_type))
  }

  // ── Frequency delegators ────────────────────────────────────

  updateFrequencies(caseId: number): void {
    this.frequencyService.updateFrequencies(caseId)
  }

  decrementFrequencies(caseId: number): void {
    this.frequencyService.decrementFrequencies(caseId)
  }

  recomputeAllFrequencies(): void {
    this.frequencyService.recomputeAllFrequencies()
  }

  getFilterOptions(caseId: number): FilterOptions {
    const columnMeta = this.getAllColumnMetas(caseId)

    // Extract legacy FilterOptions fields from column metadata
    const metaByKey = new Map(columnMeta.map((m) => [m.key, m]))

    const consequenceMeta = metaByKey.get('consequence')
    const consequences = consequenceMeta?.distinctValues ?? []

    const funcMeta = metaByKey.get('func')
    const funcs = funcMeta?.distinctValues ?? []

    const clinvarMeta = metaByKey.get('clinvar')
    const clinvars = clinvarMeta?.distinctValues ?? []

    const caddMeta = metaByKey.get('cadd')
    const gnomadAfMeta = metaByKey.get('gnomad_af')

    return {
      consequences,
      funcs,
      clinvars,
      minCadd: caddMeta?.min ?? null,
      maxCadd: caddMeta?.max ?? null,
      minGnomadAf: gnomadAfMeta?.min ?? null,
      maxGnomadAf: gnomadAfMeta?.max ?? null,
      columnMeta
    }
  }
}
