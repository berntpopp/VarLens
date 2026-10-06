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
    inheritance_modes: filters.inheritanceModes,
    analysis_group_id: filters.analysisGroupId ?? undefined,
    consider_phasing: filters.considerPhasing,
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
    is_starred: isStarred
  }
}

/**
 * Run the Stage-1 candidate query for one variant type.
 *
 * Rows are ordered by `variants.id` ASC before the LIMIT, so the cap is
 * deterministic across invocations. This is NOT a pre-rank by scoring
 * criteria — Stage 2 orders the capped set.
 *
 * @param filter From {@link toShortlistVariantFilter}, with any active gene
 *   panel already resolved into `panel_intervals` by the caller.
 * @param limit Row cap — the caller passes `topN * 4` so Stage-3 tie-breaking
 *   has headroom.
 */
export function queryVariantsByType(
  source: ShortlistQuerySource,
  filter: VariantFilter,
  limit: number
): ShortlistCandidate[] {
  const { db, filterBuilder } = source
  const usesTempTable = filterBuilder.preparePanelIntervals(filter)
  try {
    const compiled = filterBuilder
      .build(filter)
      .select(
        sql<number>`COALESCE((SELECT cva.starred FROM case_variant_annotations cva WHERE cva.case_id = variants.case_id AND cva.variant_id = variants.id LIMIT 1), 0)`.as(
          'is_starred_int'
        )
      )
      .orderBy(sql`variants.id ASC`)
      .limit(limit)
      .compile()
    const rows = db.prepare(compiled.sql).all(...compiled.parameters) as Array<
      Variant & { is_starred_int?: number }
    >
    return rows.map(({ is_starred_int, ...row }) =>
      toShortlistCandidate(row as Variant, is_starred_int === 1)
    )
  } finally {
    if (usesTempTable) filterBuilder.cleanupPanelIntervalsTable()
  }
}
