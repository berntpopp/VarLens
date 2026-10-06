import type { Kysely } from 'kysely'
import type { VarlensDatabase } from '../../../shared/types/database-schema'
import type { VariantFilter } from '../types'
import type { VariantQueryBuilder } from './query-types'

/** Variant ids annotated per case (`case_variant_annotations`). */
function perCaseAnnotatedIds(kysely: Kysely<VarlensDatabase>, caseId: number) {
  return kysely
    .selectFrom('case_variant_annotations')
    .select('variant_id')
    .where('case_id', '=', caseId)
}

/**
 * Variant ids whose coordinates carry a global annotation
 * (`variant_annotations`, keyed by chr/pos/ref/alt). The caller appends the
 * annotation predicate and then the `v2.case_id` restriction, in that order.
 */
function globalAnnotatedIds(kysely: Kysely<VarlensDatabase>) {
  return kysely
    .selectFrom('variants as v2')
    .select('v2.id as variant_id')
    .innerJoin('variant_annotations as va', (join) =>
      join
        .onRef('va.chr', '=', 'v2.chr')
        .onRef('va.pos', '=', 'v2.pos')
        .onRef('va.ref', '=', 'v2.ref')
        .onRef('va.alt', '=', 'v2.alt')
    )
}

type PerCaseIdsQuery = ReturnType<typeof perCaseAnnotatedIds>
type GlobalIdsQuery = ReturnType<typeof globalAnnotatedIds>

/** The same annotation predicate expressed against each scope's table. */
interface AnnotationPredicate {
  perCase: (qb: PerCaseIdsQuery) => PerCaseIdsQuery
  global: (qb: GlobalIdsQuery) => GlobalIdsQuery
}

/**
 * Restrict to variants matching an annotation predicate. This is the single
 * scope switch: `annotation_scope === 'all'` matches per-case OR global
 * annotations; any other value (including undefined) is per-case only.
 */
function whereAnnotated(
  query: VariantQueryBuilder,
  kysely: Kysely<VarlensDatabase>,
  filter: VariantFilter,
  predicate: AnnotationPredicate
): VariantQueryBuilder {
  const perCase = predicate.perCase(perCaseAnnotatedIds(kysely, filter.case_id))
  if (filter.annotation_scope !== 'all') return query.where('id', 'in', perCase)
  const global = predicate
    .global(globalAnnotatedIds(kysely))
    .where('v2.case_id', '=', filter.case_id)
  return query.where('id', 'in', perCase.union(global))
}

/** Starred, has-comment and ACMG classification filters (scope-dependent). */
export function applyAnnotationScopeFilters(
  query: VariantQueryBuilder,
  kysely: Kysely<VarlensDatabase>,
  filter: VariantFilter
): VariantQueryBuilder {
  let filtered = query
  if (filter.starred_only === true) {
    filtered = whereAnnotated(filtered, kysely, filter, {
      perCase: (qb) => qb.where('starred', '=', 1),
      global: (qb) => qb.where('va.starred', '=', 1)
    })
  }
  if (filter.has_comment === true) {
    filtered = whereAnnotated(filtered, kysely, filter, {
      perCase: (qb) =>
        qb.where('per_case_comment', 'is not', null).where('per_case_comment', '!=', ''),
      global: (qb) =>
        qb.where('va.global_comment', 'is not', null).where('va.global_comment', '!=', '')
    })
  }
  const classifications = filter.acmg_classifications
  if (classifications !== undefined && classifications.length > 0) {
    filtered = whereAnnotated(filtered, kysely, filter, {
      perCase: (qb) => qb.where('acmg_classification', 'in', classifications),
      global: (qb) => qb.where('va.acmg_classification', 'in', classifications)
    })
  }
  return filtered
}
