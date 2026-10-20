import { BaseRepository } from './BaseRepository'
import type { CaseRepository } from './CaseRepository'
import type { Database as DatabaseType, Statement } from 'better-sqlite3-multiple-ciphers'
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
  ps?: number | null
  _sv?: SvExtensionRow
  _cnv?: CnvExtensionRow
  _str?: StrExtensionRow
}

import { DATABASE_CONFIG, annotationSeverityRanks } from '../../shared/config'
import { VariantFilterBuilder } from './VariantFilterBuilder'
import { attachCaseTagIds, caseTagIdsSql, idListParam } from '../../shared/sql/variant-tag-ids-sql'
import { attachCasePhenotype, casePhenotypePageSql } from '../../shared/sql/phenotype-score-sql'
import { attachFamilyCalls, familyCallsPageSql } from '../../shared/sql/family-calls-sql'
import {
  attachCaseCompHetPhase,
  compHetPartnerGenes,
  type CompHetCandidateRow
} from '../../shared/utils/phasing'
import { VariantSearchService } from './VariantSearchService'
import { computeColumnMeta, VariantColumnMetaCache } from './variant-column-meta'

const BATCH_SIZE = DATABASE_CONFIG.BATCH_INSERT_SIZE

export class VariantRepository extends BaseRepository {
  private static readonly MAX_STATEMENT_CACHE_SIZE = 50
  private readonly columnMetaCache: VariantColumnMetaCache
  private cases: CaseRepository
  private readonly filterBuilder: VariantFilterBuilder
  private readonly searchService: VariantSearchService
  private ftsSnapshot: TriggerSnapshot = {}
  private readonly statementCache = new Map<string, Statement>()

  /**
   * Clear cached column metadata for a specific case, or all cases if omitted.
   */
  clearColumnMetaCache(caseId?: number): void {
    this.columnMetaCache.clear(caseId)
  }

  constructor(db: DatabaseType, kysely: Kysely<VarlensDatabase>, cases: CaseRepository) {
    super(db, kysely)
    this.cases = cases
    this.searchService = new VariantSearchService(db, kysely)
    this.filterBuilder = new VariantFilterBuilder(db, kysely, this.searchService)
    this.columnMetaCache = new VariantColumnMetaCache(db)
  }

  private getStatement(sql: string): Statement {
    let stmt = this.statementCache.get(sql)
    if (stmt === undefined) {
      if (this.statementCache.size >= VariantRepository.MAX_STATEMENT_CACHE_SIZE) {
        const oldestKey = this.statementCache.keys().next().value
        if (oldestKey !== undefined) this.statementCache.delete(oldestKey)
      }
      stmt = this.db.prepare(sql)
      this.statementCache.set(sql, stmt)
    }
    return stmt
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
              hpo_match: v.hpo_match ?? null,
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
              caller: v.caller ?? null,
              ps: v.ps ?? null,
              ...annotationSeverityRanks(v)
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

          if (v._sv !== undefined) {
            this.execRun(
              this.kysely.insertInto('variant_sv').values({ variant_id: variantId, ...v._sv })
            )
          } else if (v._cnv !== undefined) {
            this.execRun(
              this.kysely.insertInto('variant_cnv').values({ variant_id: variantId, ...v._cnv })
            )
          } else if (v._str !== undefined) {
            this.execRun(
              this.kysely.insertInto('variant_str').values({ variant_id: variantId, ...v._str })
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
   * `finishBulkInsert()`.
   */
  finishBulkInsertNoCount(): void {
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

    try {
      this.db.exec('ANALYZE')
    } catch (error) {
      mainLogger.error(`Failed to run ANALYZE: ${error}`, 'VariantRepository')
    }

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
   * Convenience method: drop FTS triggers, insert all variants in batches,
   * then rebuild FTS and restore triggers in a single call.
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

  getVariantCount(caseId: number): number {
    const result = this.execFirst<{ count: number }>(
      this.kysely
        .selectFrom('variants')
        .select(({ fn }) => fn.countAll<number>().as('count'))
        .where('case_id', '=', caseId)
    )
    return result?.count ?? 0
  }

  /** Get variant counts grouped by variant_type for a case. */
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
        const compiled = this.filterBuilder.build(filter).compile()
        const countSql = `SELECT count(*) as count FROM (${compiled.sql})`
        const countResult = this.db.prepare(countSql).get(...compiled.parameters) as {
          count: number
        }
        total_count = countResult.count
      }

      const dataQuery = this.filterBuilder.build(filter, { sortBy })
      const sortedQuery = this.filterBuilder
        .applySort(dataQuery, sortBy)
        .limit(limit)
        .offset(offset)
      const data = this.execAll<Variant>(sortedQuery)
      if (data.length > 0) {
        const ids = idListParam(
          'sqlite',
          data.map((v) => v.id)
        )
        const hits = this.getStatement(caseTagIdsSql('sqlite')).all(filter.case_id, ids)
        attachCaseTagIds(data, hits as Array<{ variant_id: number; tag_id: number }>)
        const scores = this.getStatement(casePhenotypePageSql('sqlite')).all(filter.case_id, ids)
        attachCasePhenotype(data, scores as Parameters<typeof attachCasePhenotype>[1])
        if (filter.analysis_group_id !== undefined) {
          const famHits = this.getStatement(familyCallsPageSql('sqlite')).all(
            filter.analysis_group_id,
            filter.case_id,
            ids
          )
          attachFamilyCalls(data, famHits as Parameters<typeof attachFamilyCalls>[1])
        }
        if (filter.consider_phasing === true) {
          const allInPage =
            offset === 0 && (skipCount === true ? data.length < limit : data.length >= total_count)
          const genes = compHetPartnerGenes(data, filter, allInPage)
          const partners =
            genes === null
              ? data
              : genes.length === 0
                ? []
                : this.execAll<CompHetCandidateRow>(
                    this.filterBuilder
                      .build({ ...filter, inheritance_modes: undefined })
                      .clearSelect()
                      .select([
                        'variants.chr',
                        'variants.pos',
                        'variants.ref',
                        'variants.alt',
                        'variants.gene_symbol',
                        'variants.gt_num',
                        'variants.ps'
                      ])
                      .where('variants.gene_symbol', 'in', genes)
                  )
          attachCaseCompHetPhase(data, partners)
        }
      }

      let unfiltered_count: number | undefined
      if (includeUnfilteredCount === true) {
        const result = this.db
          .prepare(
            'SELECT COALESCE(NULLIF((SELECT variant_count FROM cases WHERE id = ?), 0), (SELECT COUNT(*) FROM variants WHERE case_id = ?)) as count'
          )
          .get(filter.case_id, filter.case_id) as { count: number }
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
      const query = this.filterBuilder.applySort(this.filterBuilder.build(filter))
      return this.execAll<Variant>(query)
    } finally {
      if (useTempTable) this.filterBuilder.cleanupPanelIntervalsTable()
    }
  }

  /** Count variants matching export filter without loading data. */
  getExportCount(filter: VariantFilter): number {
    return this.getFilteredCount(filter)
  }

  /** Return the count of variants matching a filter without fetching any data rows. */
  getFilteredCount(filter: VariantFilter): number {
    const useTempTable = this.filterBuilder.preparePanelIntervals(filter)
    try {
      const compiled = this.filterBuilder.build(filter).compile()
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
    // No temp table for compiled queries — they don't transfer to worker threads
    const query = this.filterBuilder
      .applySort(this.filterBuilder.build(filter, { forceOrChain: true }))
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
   * Results are cached per caseId and invalidated when the case stamp changes.
   * For per-column on-demand fetches (including extension columns) use the
   * scope-aware public `getColumnMeta(scope, columnKey)` below instead.
   */
  getAllColumnMetas(caseId: number): ColumnFilterMeta[] {
    return this.columnMetaCache.getAllColumnMetas(caseId)
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
    return computeColumnMeta(this.db, scope, columnKey)
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
