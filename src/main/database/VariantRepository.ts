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
import { createFTSTriggers } from './schema'
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
import { VariantFilterBuilder, SORTABLE_COLUMNS } from './VariantFilterBuilder'
import { VariantSearchService } from './VariantSearchService'
import { VariantFrequencyService } from './VariantFrequencyService'

const BATCH_SIZE = DATABASE_CONFIG.BATCH_INSERT_SIZE

const NUMERIC_COLUMNS = new Set(['pos', 'gnomad_af', 'cadd', 'qual', 'hpo_sim_score'])

/** Columns that are computed at query time (not physical table columns) -- excluded from getColumnMeta */
const COMPUTED_COLUMNS = new Set(['internal_af'])

export class VariantRepository extends BaseRepository {
  private cases: CaseRepository
  private readonly filterBuilder: VariantFilterBuilder
  private readonly searchService: VariantSearchService
  private readonly frequencyService: VariantFrequencyService

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
    this.db.exec(`
      DROP TRIGGER IF EXISTS variants_fts_ai;
      DROP TRIGGER IF EXISTS variants_fts_ad;
      DROP TRIGGER IF EXISTS variants_fts_au;
    `)
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
   * Rebuild FTS, recreate triggers, update case variant_count, run ANALYZE and optimize.
   * Call this once after all `insertBatch()` calls to complete a bulk insert session.
   */
  finishBulkInsert(caseId: number, totalInserted: number): void {
    this.cases.updateCaseVariantCount(caseId, totalInserted)

    // Always rebuild FTS and restore triggers, even if a step fails
    try {
      this.db.exec("INSERT INTO variants_fts(variants_fts) VALUES('rebuild')")
    } catch (error) {
      mainLogger.error(`Failed to rebuild FTS index: ${error}`, 'VariantRepository')
    }

    try {
      this.db.exec(createFTSTriggers)
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

      // Data query with sort + pagination
      const dataQuery = this.filterBuilder.build(filter)
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
   * Gather per-column metadata for filter UI auto-detection.
   * Consolidated: one aggregate query for all COUNT DISTINCT + MIN/MAX,
   * then one UNION ALL query for distinct values of low-cardinality columns.
   */
  private getColumnMeta(caseId: number): ColumnFilterMeta[] {
    const DISTINCT_THRESHOLD = 50
    // Exclude computed columns (e.g. internal_af) which don't exist as physical table columns
    const columns = Object.entries(SORTABLE_COLUMNS).filter(([key]) => !COMPUTED_COLUMNS.has(key))

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
      // SAFETY: sqlCol values come from hardcoded SORTABLE_COLUMNS constant
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
    const columnMeta = this.getColumnMeta(caseId)

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
