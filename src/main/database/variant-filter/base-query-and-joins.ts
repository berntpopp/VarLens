import { sql, type Kysely } from 'kysely'
import type { VarlensDatabase } from '../../../shared/types/database-schema'
import type { SortItem, VariantFilter } from '../types'
import { buildExtensionJoinClauses, type ExtensionTypeKey } from '../variant-extension-registry'
import type { VariantQueryBuilder } from './query-types'
import { resolveSortColumn } from './sortable-columns'

/**
 * SELECT skeleton shared by every case variant query: all `variants` columns,
 * the `variant_frequency` LEFT JOIN, the computed `internal_af` projection and
 * the mandatory case predicate.
 */
export function createBaseVariantQuery(
  kysely: Kysely<VarlensDatabase>,
  filter: VariantFilter
): VariantQueryBuilder {
  return kysely
    .selectFrom('variants')
    .selectAll('variants')
    .leftJoin('variant_frequency as vf', (join) =>
      join
        .onRef('vf.chr', '=', 'variants.chr')
        .onRef('vf.pos', '=', 'variants.pos')
        .onRef('vf.ref', '=', 'variants.ref')
        .onRef('vf.alt', '=', 'variants.alt')
    )
    .select(
      sql<number | null>`CAST(vf.case_count AS REAL) / NULLIF((SELECT COUNT(*) FROM cases WHERE import_status = 'ready'), 0)`.as(
        'internal_af'
      )
    )
    .where('variants.case_id', '=', filter.case_id)
}

/** Variant type filter (snv includes both snv and indel unless `exact_variant_type`). */
export function applyVariantTypeFilter(
  query: VariantQueryBuilder,
  filter: VariantFilter
): VariantQueryBuilder {
  return query.$if(filter.variant_type !== undefined && filter.variant_type !== '', (qb) => {
    if (filter.variant_type === 'snv' && filter.exact_variant_type !== true) {
      return qb.where((eb) =>
        eb.or([eb('variants.variant_type', '=', 'snv'), eb('variants.variant_type', '=', 'indel')])
      )
    }
    return qb.where('variants.variant_type', '=', filter.variant_type!)
  })
}

function joinSvProjection(query: VariantQueryBuilder): VariantQueryBuilder {
  return query
    .leftJoin('variant_sv as sv', 'sv.variant_id', 'variants.id')
    .select([
      'sv.support as _sv_support',
      'sv.dr as _sv_dr',
      'sv.dv as _sv_dv',
      'sv.vaf as _sv_vaf',
      'sv.sv_is_precise as _sv_is_precise',
      'sv.strand as _sv_strand',
      'sv.coverage as _sv_coverage',
      'sv.stdev_len as _sv_stdev_len',
      'sv.stdev_pos as _sv_stdev_pos'
    ])
}

function joinCnvProjection(query: VariantQueryBuilder): VariantQueryBuilder {
  return query
    .leftJoin('variant_cnv as cnv', 'cnv.variant_id', 'variants.id')
    .select([
      'cnv.copy_number as _cnv_copy_number',
      'cnv.copy_number_quality as _cnv_gq',
      'cnv.homozygosity_ref as _cnv_ho_ref',
      'cnv.homozygosity_alt as _cnv_ho_alt'
    ])
}

function joinStrProjection(query: VariantQueryBuilder): VariantQueryBuilder {
  return query
    .leftJoin('variant_str as str_ext', 'str_ext.variant_id', 'variants.id')
    .select([
      'str_ext.repeat_id as _str_repeat_id',
      'str_ext.repeat_unit as _str_repeat_unit',
      'str_ext.display_repeat_unit as _str_display_ru',
      'str_ext.ref_copies as _str_ref_copies',
      'str_ext.alt_copies as _str_alt_copies',
      'str_ext.str_status as _str_status',
      'str_ext.normal_max as _str_normal_max',
      'str_ext.pathologic_min as _str_pathologic_min',
      'str_ext.disease as _str_disease',
      'str_ext.inheritance_mode as _str_inheritance_mode',
      'str_ext.rank_score as _str_rank_score'
    ])
}

/** Extension table JOIN + `_<type>_*` projections for type-specific queries. */
export function applyVariantTypeProjectionJoin(
  query: VariantQueryBuilder,
  filter: VariantFilter
): VariantQueryBuilder {
  if (filter.variant_type === 'sv') return joinSvProjection(query)
  if (filter.variant_type === 'cnv') return joinCnvProjection(query)
  if (filter.variant_type === 'str') return joinStrProjection(query)
  return query
}

interface ExtensionFilterClauses {
  whereClause: string
  params: (string | number)[]
}

interface ExtensionRequirements {
  joins: Set<ExtensionTypeKey>
  clauses: ExtensionFilterClauses | null
}

/**
 * Collect the extension aliases needed by dotted `column_filters` keys
 * (e.g. `cnv.copy_number`) and by extension sort keys (e.g. `sv.support`).
 */
function collectExtensionRequirements(
  filter: VariantFilter,
  sortBy: SortItem[] | undefined
): ExtensionRequirements {
  const joins = new Set<ExtensionTypeKey>()
  let clauses: ExtensionFilterClauses | null = null

  if (filter.column_filters !== undefined) {
    // When the caller has an active variant_type filter, it already emits
    // its own `variants.variant_type = X` predicate. Skip the implicit
    // single-type narrowing inside `buildExtensionJoinClauses` so we don't
    // duplicate the predicate in the final SQL (which inflates query plans
    // even though SQLite resolves it correctly).
    const callerHasTypeFilter = filter.variant_type !== undefined && filter.variant_type !== ''
    const result = buildExtensionJoinClauses(filter.column_filters, 'variants', {
      skipImplicitNarrowing: callerHasTypeFilter
    })
    for (const alias of result.requiredJoinAliases) joins.add(alias)
    clauses = { whereClause: result.whereClause, params: result.params }
  }

  // Extension joins implied by sort keys (e.g. ORDER BY sv.support)
  for (const sort of sortBy ?? []) {
    const resolved = resolveSortColumn(sort.key)
    if (resolved !== null && resolved.isExtension && resolved.extensionType !== undefined) {
      joins.add(resolved.extensionType)
    }
  }
  return { joins, clauses }
}

/**
 * Add each required extension JOIN exactly once. sv/cnv are skipped when the
 * variant_type projection join already added the same alias (Kysely would
 * otherwise fail with "alias already used"); `str` is always added because
 * the projection join uses the distinct alias `str_ext` on the same physical
 * table, so both joins coexist without conflict.
 */
function joinRequiredExtensions(
  query: VariantQueryBuilder,
  joins: Set<ExtensionTypeKey>,
  variantType: string | undefined
): VariantQueryBuilder {
  let joined = query
  if (joins.has('sv') && variantType !== 'sv') {
    joined = joined.leftJoin(
      'variant_sv as sv',
      'sv.variant_id',
      'variants.id'
    ) as VariantQueryBuilder
  }
  if (joins.has('cnv') && variantType !== 'cnv') {
    joined = joined.leftJoin(
      'variant_cnv as cnv',
      'cnv.variant_id',
      'variants.id'
    ) as VariantQueryBuilder
  }
  if (joins.has('str')) {
    joined = joined.leftJoin(
      'variant_str as str',
      'str.variant_id',
      'variants.id'
    ) as VariantQueryBuilder
  }
  return joined
}

/**
 * Apply the raw extension WHERE clause via the same sql template
 * interpolation pattern used by VariantSearchService.
 */
function whereExtensionClauses(
  query: VariantQueryBuilder,
  clauses: ExtensionFilterClauses | null
): VariantQueryBuilder {
  if (clauses === null || clauses.whereClause === '') return query
  const segments = clauses.whereClause.split('?')
  let rawExpr = sql<boolean>`${sql.raw(segments[0])}`
  for (let i = 1; i < segments.length; i++) {
    rawExpr = sql<boolean>`${rawExpr}${clauses.params[i - 1]}${sql.raw(segments[i])}`
  }
  return query.where(rawExpr)
}

/** Extension table JOINs and predicates for dotted-key filters and sorts. */
export function applyExtensionFiltersAndSortJoins(
  query: VariantQueryBuilder,
  filter: VariantFilter,
  sortBy: SortItem[] | undefined
): VariantQueryBuilder {
  const { joins, clauses } = collectExtensionRequirements(filter, sortBy)
  return whereExtensionClauses(joinRequiredExtensions(query, joins, filter.variant_type), clauses)
}
