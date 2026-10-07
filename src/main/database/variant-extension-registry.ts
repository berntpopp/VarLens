/**
 * Variant extension registry — main-process entry point.
 *
 * Re-exports the pure data module at `src/shared/types/variant-extension-registry-data.ts`
 * (types, `VARIANT_EXTENSION_REGISTRY`, derived key sets, `isExtensionColumnKey`,
 * `resolveExtensionColumnKey`) so the renderer can share the SAME registry
 * shape without crossing the Electron main-process boundary.
 *
 * This file additionally owns the SQL-emitting helpers that translate
 * `column_filters` into JOIN + WHERE clauses (`buildExtensionJoinClauses`)
 * and EXISTS clauses (`buildExtensionExistsClauses`). Those helpers must
 * stay main-side because they are only ever called from the query builders.
 */
import type { ColumnFilter, ColumnFiltersParam } from '../../shared/types/column-filters'
import { NUMERIC_COLUMN_FILTER_KEYS } from '../../shared/filters/column-filter-validation'
import { buildNullCheckSql, isNullCheckOperator } from '../../shared/filters/column-null-check'
import {
  VARIANT_EXTENSION_REGISTRY,
  resolveExtensionColumnKey,
  type ExtensionTypeKey
} from '../../shared/types/variant-extension-registry-data'

export * from '../../shared/types/variant-extension-registry-data'

/** Whether a dotted extension key (`cnv.copy_number`) names a numeric column. */
function isNumericKey(dottedKey: string): boolean {
  return NUMERIC_COLUMN_FILTER_KEYS.has(dottedKey)
}

// ── Extension filter → JOIN + WHERE clause builder ────────────

/**
 * Result of translating column_filters into extension JOIN + WHERE clauses.
 *
 * Used by Path 1 (VariantFilterBuilder) to wire extension-table filters into
 * the case-scoped variant query. Path 2 (CohortSearch EXISTS) uses a separate
 * `buildExtensionExistsClauses` helper that wraps the same primitives.
 */
export interface BuildExtensionJoinResult {
  /**
   * Raw SQL fragment containing `LEFT JOIN` clauses for every distinct
   * extension table referenced by the filters. One line per table. Empty
   * string when no extension filters were present.
   *
   * NOTE: Only Path 3 (`AssociationDataBuilder`) consumes this raw string
   * form verbatim, because it composes its SQL by hand. Path 1
   * (`VariantFilterBuilder`) uses Kysely chain builders and drives joins
   * from `requiredJoinAliases` via `.leftJoin()` for type safety — it does
   * NOT use this string. Path 2 (`CohortService`) uses the EXISTS-subquery
   * variant (`buildExtensionExistsClauses`) and doesn't need joins at all.
   */
  joins: string
  /**
   * Raw SQL fragment for the WHERE clause, joined by ` AND `. Parameter
   * placeholders use `?`. When a single extension type is referenced, an
   * implicit `<base>.variant_type = 'sv|cnv|str'` narrowing is prepended so
   * the query planner can use `idx_variants_type_case`.
   */
  whereClause: string
  /** Ordered placeholder values matching each `?` in `whereClause`. */
  params: (string | number)[]
  /**
   * When all extension filters target a single type, reports that type so
   * callers can fold it into higher-level narrowing (e.g. skip the LEFT
   * JOIN when the variant_type filter already added an INNER JOIN). `null`
   * when filters span multiple extension types (cross-type), in which case
   * the caller should NOT emit a single-type narrowing elsewhere.
   */
  implicitTypeNarrowing: ExtensionTypeKey | null
  /**
   * Set of extension type keys whose JOIN is required. Callers can use this
   * to skip adding duplicate joins when another code path already added the
   * same alias (e.g. `filter.variant_type === 'sv'` → `sv` join already
   * present).
   */
  requiredJoinAliases: Set<ExtensionTypeKey>
}

/**
 * Translate a `column_filters` map into an extension JOIN + WHERE plan.
 *
 * Scans every key for dotted extension keys (e.g. `cnv.copy_number`) and:
 * 1. Resolves each to its extension registry entry.
 * 2. Collects required LEFT JOINs (one per distinct extension type).
 * 3. Emits per-filter WHERE clauses using the extension join alias.
 * 4. Emits a single-type narrowing clause when only one extension type is
 *    referenced, so the query planner can use `idx_variants_type_case`.
 *
 * Bare keys (base columns like `gnomad_af`) and unknown dotted keys are
 * silently ignored — the base filter builder handles bare keys and unknown
 * keys are dropped defensively.
 *
 * NULL semantics: extension numeric range filters default to **exclude** NULL
 * (no extension row = variant not of that type → should not be returned),
 * unlike base filters which default to include. Callers can override via
 * `ColumnFilter.includeEmpty = true` on individual filters.
 */
export function buildExtensionJoinClauses(
  columnFilters: ColumnFiltersParam,
  baseVariantAlias: string,
  options: { skipImplicitNarrowing?: boolean } = {}
): BuildExtensionJoinResult {
  const params: (string | number)[] = []
  const whereFragments: string[] = []
  const joinSet = new Set<ExtensionTypeKey>()
  const typesSeen = new Set<ExtensionTypeKey>()

  for (const [key, filter] of Object.entries(columnFilters)) {
    const resolved = resolveExtensionColumnKey(key)
    if (resolved === null) continue
    joinSet.add(resolved.typeKey)
    typesSeen.add(resolved.typeKey)
    const col = `${resolved.def.joinAlias}.${resolved.column}`
    const clause = translateExtensionFilter(col, filter, params, isNumericKey(key))
    if (clause !== null) whereFragments.push(clause)
  }

  let implicit: ExtensionTypeKey | null = null
  if (typesSeen.size === 1) {
    const only = [...typesSeen][0]
    implicit = only
    // Prepend the single-type narrowing so query planner uses
    // idx_variants_type_case — UNLESS the caller has already emitted its own
    // `variant_type = X` predicate (e.g. Path 1 when filter.variant_type is
    // active), in which case duplicating the predicate inflates query plans.
    // `implicitTypeNarrowing` is still populated so callers that track
    // cross-type narrowing (AssociationDataBuilder / CohortService) see it.
    if (options.skipImplicitNarrowing !== true) {
      whereFragments.unshift(
        `${baseVariantAlias}.variant_type = '${VARIANT_EXTENSION_REGISTRY[only].variantTypeValue}'`
      )
    }
  }

  const joins = [...joinSet]
    .map((typeKey) => {
      const def = VARIANT_EXTENSION_REGISTRY[typeKey]
      return `LEFT JOIN ${def.table} ${def.joinAlias} ON ${def.joinAlias}.${def.variantIdColumn} = ${baseVariantAlias}.id`
    })
    .join('\n')

  return {
    joins,
    whereClause: whereFragments.join(' AND '),
    params,
    implicitTypeNarrowing: implicit,
    requiredJoinAliases: joinSet
  }
}

// ── Extension filter → EXISTS subquery builder (cohort-listing path) ──

/**
 * Result of translating column_filters into EXISTS subquery clauses.
 *
 * Used by Path 2 (CohortService) to wire extension-table filters into the
 * cohort-listing query. Cohort queries run against the pre-computed
 * `cohort_variant_summary` table, which has no `variant_id` column, so we
 * cannot JOIN the extension table directly. Instead, we emit an EXISTS
 * subquery that correlates on `(chr, pos, ref, alt, variant_type)` back to
 * `variants` + the extension table.
 */
export interface BuildExtensionExistsResult {
  /**
   * Raw SQL fragment containing a single-type `cvs.variant_type = '…'`
   * narrowing (when all filters target one type) plus one EXISTS block per
   * distinct extension type, joined by ` AND `. Empty string when no
   * extension filters were present.
   */
  whereClause: string
  /** Ordered placeholder values matching each `?` in `whereClause`. */
  params: (string | number)[]
  /**
   * When all extension filters target a single type, reports that type so
   * callers can fold it into higher-level narrowing. `null` when filters
   * span multiple extension types (cross-type).
   */
  implicitTypeNarrowing: ExtensionTypeKey | null
}

/**
 * Translate a `column_filters` map into EXISTS subquery clauses against
 * `cohort_variant_summary`.
 *
 * Groups filters by extension type (so two CNV filters share one EXISTS
 * block). For each type, emits:
 * ```
 * EXISTS (
 *   SELECT 1 FROM variants v
 *   JOIN <ext_table> <alias> ON <alias>.variant_id = v.id
 *   WHERE v.chr = cvs.chr AND v.pos = cvs.pos AND v.ref = cvs.ref
 *     AND v.alt = cvs.alt AND v.variant_type = cvs.variant_type
 *     AND <inner conditions>
 * )
 * ```
 *
 * When all filters target a single extension type, a leading
 * `<cvsAlias>.variant_type = '<type>'` narrowing is prepended to help the
 * query planner. Operator semantics match `buildExtensionJoinClauses` exactly
 * because both paths share the `translateExtensionFilter` primitive.
 */
export function buildExtensionExistsClauses(
  columnFilters: ColumnFiltersParam,
  cvsAlias: string
): BuildExtensionExistsResult {
  const byType = new Map<ExtensionTypeKey, Array<{ column: string; filter: ColumnFilter }>>()
  for (const [key, filter] of Object.entries(columnFilters)) {
    const resolved = resolveExtensionColumnKey(key)
    if (resolved === null) continue
    if (!byType.has(resolved.typeKey)) byType.set(resolved.typeKey, [])
    byType.get(resolved.typeKey)!.push({ column: resolved.column, filter })
  }

  if (byType.size === 0) {
    return { whereClause: '', params: [], implicitTypeNarrowing: null }
  }

  const fragments: string[] = []
  const params: (string | number)[] = []

  let implicit: ExtensionTypeKey | null = null
  if (byType.size === 1) {
    const only = [...byType.keys()][0]
    implicit = only
    fragments.push(
      `${cvsAlias}.variant_type = '${VARIANT_EXTENSION_REGISTRY[only].variantTypeValue}'`
    )
  }

  for (const [typeKey, filters] of byType) {
    const def = VARIANT_EXTENSION_REGISTRY[typeKey]
    const alias = def.joinAlias
    const innerConditions: string[] = []
    for (const { column, filter } of filters) {
      const col = `${alias}.${column}`
      const numeric = isNumericKey(`${typeKey}.${column}`)
      const clause = translateExtensionFilter(col, filter, params, numeric)
      if (clause !== null) innerConditions.push(clause)
    }
    if (innerConditions.length === 0) continue
    fragments.push(
      `EXISTS (
        SELECT 1 FROM variants v
        JOIN cases vc ON vc.id = v.case_id AND vc.import_status = 'ready'
        JOIN ${def.table} ${alias} ON ${alias}.${def.variantIdColumn} = v.id
        WHERE v.chr = ${cvsAlias}.chr
          AND v.pos = ${cvsAlias}.pos
          AND v.ref = ${cvsAlias}.ref
          AND v.alt = ${cvsAlias}.alt
          AND v.variant_type = ${cvsAlias}.variant_type
          AND ${innerConditions.join(' AND ')}
      )`
    )
  }

  return { whereClause: fragments.join(' AND '), params, implicitTypeNarrowing: implicit }
}

/**
 * Translate a single extension ColumnFilter into a parameterized SQL fragment.
 *
 * Pushes parameter values into the shared `params` array. Returns the SQL
 * fragment or `null` when the filter should be dropped (empty IN, whitespace
 * LIKE, unsupported operator).
 *
 * NULL semantics for numeric ranges default to EXCLUDE NULLs (opposite of the
 * base-column path) because an extension row missing implies "variant is not
 * of this type". Callers can override via `includeEmpty: true`.
 */
function translateExtensionFilter(
  col: string,
  filter: ColumnFilter,
  params: (string | number)[],
  numeric: boolean
): string | null {
  const { operator, value, includeEmpty } = filter
  // Extensions default to EXCLUDE NULLs (opposite of base filters).
  const nullBranch = includeEmpty === true

  if (isNullCheckOperator(operator)) return buildNullCheckSql(col, operator, numeric, 'sqlite')

  if (operator === 'in' && Array.isArray(value)) {
    if (value.length === 0) return null
    const ph = value.map(() => '?').join(', ')
    params.push(...value)
    return `${col} IN (${ph})`
  }
  if (operator === 'like' && typeof value === 'string') {
    if (value.trim() === '') return null
    params.push(`%${value}%`)
    return `${col} LIKE ? COLLATE NOCASE`
  }
  if ((operator === '=' || operator === '!=') && !Array.isArray(value)) {
    params.push(value)
    return `${col} ${operator} ?`
  }
  if (['<', '>', '<=', '>='].includes(operator) && !Array.isArray(value)) {
    params.push(value)
    return nullBranch ? `(${col} IS NULL OR ${col} ${operator} ?)` : `${col} ${operator} ?`
  }
  return null
}
