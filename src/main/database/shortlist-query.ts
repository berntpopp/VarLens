/**
 * Stage 1 of the unified shortlist pipeline — candidate generation.
 *
 * A shortlist candidate query is the case-view variant query for one exact
 * variant type: the merged `FilterState` is mapped to a `VariantFilter`
 * ({@link toShortlistVariantFilter}) and run through the same
 * `VariantFilterBuilder` pipeline as the variant table. Every filter the case
 * view understands — gene panel regions, inheritance modes, full-text search,
 * starred / comment / ACMG / tag filters, internal frequency, column filters —
 * therefore restricts the shortlist too, and identically to the PostgreSQL
 * shortlist, which runs the same mapped filter through its own case query.
 *
 * The returned rows are flat `ShortlistCandidate` values (every `Variant`
 * column, the `sv_*` / `cnv_*` / `str_*` extension aliases and `is_starred`),
 * so Stage 2 (scoring) and Stage 3 (ranking) need no further DB access.
 *
 * Spec: .planning/specs/2026-04-11-unified-shortlist-ranked-view-design.md (§3, §4)
 */

import type { Database as DatabaseType } from 'better-sqlite3-multiple-ciphers'
import { sql } from 'kysely'
import type { Variant, VariantFilter } from '../../shared/types/database'
import type { FilterState } from '../../shared/types/filters'
import type { ShortlistCandidate, VariantTypeKey } from '../../shared/types/shortlist'
import type { VariantFilterBuilder } from './VariantFilterBuilder'

/** What a Stage-1 query needs: the connection and the case-view filter pipeline. */
export interface ShortlistQuerySource {
  db: DatabaseType
  filterBuilder: VariantFilterBuilder
}

const nonEmpty = (value: string | undefined): string | undefined =>
  value !== undefined && value !== '' ? value : undefined

/**
 * Map a merged `FilterState` snapshot (base + per-type overrides) to the
 * case-view `VariantFilter` for one variant type. Shared by the SQLite and
 * PostgreSQL shortlist so both forward exactly the same filter fields.
 *
 * `exact_variant_type` keeps `snv` from also matching `indel`: the shortlist
 * scores each type with its own scorer.
 */
export function toShortlistVariantFilter(
  caseId: number,
  variantType: VariantTypeKey,
  filters: Partial<FilterState>
): VariantFilter {
  return {
    case_id: caseId,
    variant_type: variantType,
    exact_variant_type: true,
    gene_symbol: nonEmpty(filters.geneSymbol),
    search_query: nonEmpty(filters.searchQuery),
    consequences: filters.consequences,
    funcs: filters.funcs,
    clinvars: filters.clinvars,
    gnomad_af_max: filters.maxGnomadAf ?? undefined,
    cadd_min: filters.minCadd ?? undefined,
    starred_only: filters.starredOnly,
    has_comment: filters.hasCommentOnly,
    acmg_classifications: filters.acmgClassifications,
    tag_ids: filters.tagIds,
    annotation_scope: filters.annotationScope,
    active_panel_ids: filters.activePanelIds,
    panel_padding_bp: filters.panelPaddingBp,
    max_internal_af: filters.maxInternalAf ?? undefined,
    carrier_count_max: filters.maxCarriers ?? undefined,
    inheritance_modes: filters.inheritanceModes,
    analysis_group_id: filters.analysisGroupId ?? undefined,
    consider_phasing: filters.considerPhasing,
    de_novo_min_gq: filters.deNovoMinGq ?? undefined,
    de_novo_min_dp: filters.deNovoMinDp ?? undefined,
    de_novo_min_ab: filters.deNovoMinAb ?? undefined,
    de_novo_max_parent_ab: filters.deNovoMaxParentAb ?? undefined,
    column_filters: filters.columnFilters
  }
}

function toOptionalNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const numberValue = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numberValue) ? numberValue : null
}

/**
 * Flatten a case-query row (with its `_sv_*` / `_cnv_*` / `_str_*` extension
 * projections) into the `ShortlistCandidate` contract (spec §4). Extension
 * fields of other variant types are `null`. Shared by both backends.
 */
export function toShortlistCandidate(row: Variant, isStarred: boolean): ShortlistCandidate {
  const source = row as Variant & Record<string, unknown>
  return {
    ...row,
    sv_is_precise: toOptionalNumber(source._sv_is_precise) as 0 | 1 | null,
    sv_vaf: toOptionalNumber(source._sv_vaf),
    sv_support: toOptionalNumber(source._sv_support),
    cnv_copy_number: toOptionalNumber(source._cnv_copy_number),
    cnv_copy_number_quality: toOptionalNumber(source._cnv_gq),
    str_status: (source._str_status as ShortlistCandidate['str_status']) ?? null,
    str_disease: (source._str_disease as string | null | undefined) ?? null,
    str_alt_copies: (source._str_alt_copies as string | null | undefined) ?? null,
    str_repeat_id: (source._str_repeat_id as string | null | undefined) ?? null,
    str_variant_catalog_id: (source._str_variant_catalog_id as string | null | undefined) ?? null,
    str_repeat_unit: (source._str_repeat_unit as string | null | undefined) ?? null,
    is_starred: isStarred
  }
}

/**
 * Rows per Stage-1 page on both backends. Bounds memory to
 * O(topN + page) while every eligible candidate is still scored (#537).
 */
export const SHORTLIST_PAGE_SIZE = 2000

/**
 * Eligible rows the evidence ranking keeps from pass 1 for pass 2 (~75 MB at
 * the cap); a case with more re-queries in pass 2 so memory stays bounded.
 */
export const SHORTLIST_BUFFER_MAX_ROWS = 50_000

/**
 * Stream every eligible candidate of one variant type to `onPage` in pages of
 * `pageSize` rows (ordered by `variants.id`, only as a deterministic order —
 * Stage 2 ranks the rows), preparing panel regions once.
 *
 * One query execution is streamed: `LIMIT`-paged re-queries let SQLite pick a
 * rowid scan that walks every earlier case's rows on each page. While it runs
 * the connection is busy, so `onPage` must not use it.
 *
 * @param filter From {@link toShortlistVariantFilter}, with any active gene
 *   panel already resolved into `panel_intervals` by the caller.
 */
export function forEachCandidatePage(
  source: ShortlistQuerySource,
  filter: VariantFilter,
  pageSize: number,
  onPage: (rows: ShortlistCandidate[]) => void
): void {
  withPanelIntervals(source, filter, () => {
    const { db, filterBuilder } = source
    const compiled = filterBuilder
      .build(filter)
      .select(
        sql<number>`COALESCE((SELECT cva.starred FROM case_variant_annotations cva WHERE cva.case_id = variants.case_id AND cva.variant_id = variants.id LIMIT 1), 0)`.as(
          'is_starred'
        )
      )
      .orderBy(sql`variants.id ASC`)
      .compile()
    const statement = db.prepare(compiled.sql).raw(true)
    const columns = statement.columns().map((column) => column.name)
    let page: ShortlistCandidate[] = []
    for (const values of statement.iterate(...compiled.parameters) as Iterable<unknown[]>) {
      // better-sqlite3 row objects are slow to copy (~4 µs per wide row), so build plain
      // objects from raw rows; toShortlistCandidate makes the one copy and overwrites the
      // 0/1 `is_starred` with a boolean.
      const row: Record<string, unknown> = {}
      for (let i = 0; i < columns.length; i++) row[columns[i]] = values[i]
      page.push(toShortlistCandidate(row as unknown as Variant, row.is_starred === 1))
      if (page.length === pageSize) {
        onPage(page)
        page = []
      }
    }
    if (page.length > 0) onPage(page)
  })
}

function withPanelIntervals<T>(
  { filterBuilder }: ShortlistQuerySource,
  filter: VariantFilter,
  run: () => T
): T {
  const usesTempTable = filterBuilder.preparePanelIntervals(filter)
  try {
    return run()
  } finally {
    if (usesTempTable) filterBuilder.cleanupPanelIntervalsTable()
  }
}
