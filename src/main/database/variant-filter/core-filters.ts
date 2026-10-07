import { whereSeverity } from './severity-filter'
import type { Database as DatabaseType } from 'better-sqlite3-multiple-ciphers'
import { sql, type Kysely } from 'kysely'
import type { VarlensDatabase } from '../../../shared/types/database-schema'
import type { VariantFilter } from '../types'
import type { VariantQueryBuilder } from './query-types'

/**
 * Pre-compute the total case count so the internal-AF filter does not run a
 * per-row subquery. Returns `undefined` when the filter is inactive.
 */
export function countCasesForInternalAf(
  db: DatabaseType,
  kysely: Kysely<VarlensDatabase>,
  filter: VariantFilter
): number | undefined {
  if (filter.max_internal_af === undefined || !(filter.max_internal_af > 0)) return undefined
  const compiled = kysely
    .selectFrom('cases')
    .select(kysely.fn.countAll<number>().as('cnt'))
    // Same denominator as the internal_af column (base-query-and-joins.ts).
    .where('import_status', '=', 'ready')
    .compile()
  const countResult = db.prepare(compiled.sql).get(...compiled.parameters) as
    { cnt: number } | undefined
  return countResult?.cnt ?? 0
}

/** Gene, consequence(s), func and ClinVar filters. */
export function applyAnnotationValueFilters(
  query: VariantQueryBuilder,
  filter: VariantFilter
): VariantQueryBuilder {
  return (
    query
      .$if(filter.gene_symbol !== undefined && filter.gene_symbol !== '', (qb) =>
        qb.where('gene_symbol', 'like', `%${filter.gene_symbol}%`)
      )
      // consequence vs consequences — mutually exclusive
      .$if((filter.consequences?.length ?? 0) > 0, (qb) =>
        whereSeverity(qb, 'consequence', filter.consequences!)
      )
      .$if(
        (filter.consequences === undefined || filter.consequences.length === 0) &&
          filter.consequence !== undefined &&
          filter.consequence !== '',
        (qb) => qb.where('consequence', '=', filter.consequence!)
      )
      .$if((filter.funcs?.length ?? 0) > 0, (qb) => qb.where('func', 'in', filter.funcs!))
      .$if((filter.clinvars?.length ?? 0) > 0, (qb) =>
        whereSeverity(qb, 'clinvar', filter.clinvars!)
      )
  )
}

/** gnomAD AF / CADD range filters with NULL handling (unannotated rows pass). */
export function applyScoreRangeFilters(
  query: VariantQueryBuilder,
  filter: VariantFilter
): VariantQueryBuilder {
  return query
    .$if(filter.gnomad_af_max !== undefined, (qb) =>
      qb.where(({ or, eb }) =>
        or([eb('gnomad_af', 'is', null), eb('gnomad_af', '<=', filter.gnomad_af_max!)])
      )
    )
    .$if(filter.cadd_min !== undefined, (qb) =>
      qb.where(({ or, eb }) => or([eb('cadd', 'is', null), eb('cadd', '>=', filter.cadd_min!)]))
    )
}

/** Internal AF filter (NULL-inclusive: variants without frequency data pass). */
export function applyInternalAfFilter(
  query: VariantQueryBuilder,
  filter: VariantFilter,
  totalCaseCount: number | undefined
): VariantQueryBuilder {
  return query.$if(
    filter.max_internal_af !== undefined &&
      filter.max_internal_af > 0 &&
      totalCaseCount !== undefined &&
      totalCaseCount > 0,
    (qb) =>
      qb.where(({ or, eb }) =>
        or([
          eb(sql.ref('vf.case_count'), 'is', null),
          eb(
            sql<number>`CAST(vf.case_count AS REAL) / ${totalCaseCount!}`,
            '<=',
            filter.max_internal_af!
          )
        ])
      )
  )
}

/** Exact variant match (table-qualified to avoid ambiguity with LEFT JOIN). */
export function applyExactVariantMatch(
  query: VariantQueryBuilder,
  filter: VariantFilter
): VariantQueryBuilder {
  return query
    .$if(filter.chr != null && filter.chr !== '', (qb) =>
      qb.where('variants.chr', '=', filter.chr!)
    )
    .$if(filter.pos != null, (qb) => qb.where('variants.pos', '=', filter.pos!))
    .$if(filter.ref != null && filter.ref !== '', (qb) =>
      qb.where('variants.ref', '=', filter.ref!)
    )
    .$if(filter.alt != null && filter.alt !== '', (qb) =>
      qb.where('variants.alt', '=', filter.alt!)
    )
}

/** Tag filter (OR across tag ids, scoped to the case). */
export function applyTagFilter(
  query: VariantQueryBuilder,
  kysely: Kysely<VarlensDatabase>,
  filter: VariantFilter
): VariantQueryBuilder {
  return query.$if((filter.tag_ids?.length ?? 0) > 0, (qb) =>
    qb.where(
      'id',
      'in',
      kysely
        .selectFrom('variant_tags')
        .select('variant_id')
        .where('case_id', '=', filter.case_id)
        .where('tag_id', 'in', filter.tag_ids!)
    )
  )
}

/** Interval count at which the panel filter switches to the temp table. */
export const PANEL_TEMP_TABLE_THRESHOLD = 50

/**
 * Panel genomic interval filter (overlap semantics).
 *
 * Small sets (or `forceOrChain` for compiled queries) emit an OR chain of
 * chr + position-range conditions. Large sets read the `_panel_intervals`
 * temp table, which `preparePanelIntervals` must have populated first.
 */
export function applyPanelIntervalFilter(
  query: VariantQueryBuilder,
  filter: VariantFilter,
  forceOrChain: boolean | undefined
): VariantQueryBuilder {
  const panelIntervals = filter.panel_intervals
  if (!panelIntervals || panelIntervals.length === 0) return query
  if (panelIntervals.length < PANEL_TEMP_TABLE_THRESHOLD || forceOrChain === true) {
    return query.where(({ or }) =>
      or(
        panelIntervals.map(
          (iv) =>
            sql<boolean>`(variants.chr = ${iv.chr} AND variants.pos <= ${iv.end} AND COALESCE(variants.end_pos, variants.pos) >= ${iv.start})`
        )
      )
    )
  }
  return query.where(
    sql<boolean>`EXISTS (SELECT 1 FROM _panel_intervals pi WHERE variants.chr = pi.chr AND variants.pos <= pi.end_pos AND COALESCE(variants.end_pos, variants.pos) >= pi.start_pos)`
  )
}
