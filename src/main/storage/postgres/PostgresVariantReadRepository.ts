import {
  severityFilterSql,
  type SeverityFilterTarget
} from '../../../shared/filters/severity-filter'
import { carrierRanks } from './cohort-summary-representative-sql'
import { caseCarrierFrequencySql } from './postgres-carrier-frequency-sql'
import { carrierTotalsSql } from './postgres-carrier-totals'
import { contigQueryNames } from '../../../shared/utils/contig'
import {
  addPostgresColumnFilters,
  hasPostgresColumnFilterPrefix,
  HGVS_TOKEN,
  hgvsSearchSql
} from './postgres-variant-column-filters'
import { booleanSearchSql } from '../../../shared/utils/boolean-search'
import type { Pool } from 'pg'

import { BASE_SORTABLE_COLUMNS } from '../../database/VariantFilterBuilder'
import type {
  PaginatedResult,
  SortItem,
  Variant,
  VariantFilter
} from '../../../shared/types/database'
import type { FilterOptions } from '../../../shared/types/api'
import type { ColumnFilterMeta } from '../../../shared/types/column-filters'
import { quoteIdentifier, toNumber } from './identifiers'
import {
  columnMetaRowToFilterMeta,
  emptyColumnMeta,
  reshapeFilterOptions
} from './postgres-column-meta-cache'
import type { ColumnMetaRow } from './postgres-column-meta-cache'
import {
  getCategoricalColumnMetaLive,
  getNumericColumnMetaLive
} from './postgres-variant-column-meta-live'
import { runNamed, runNamedDynamic } from './named-query'
import { POSTGRES_VARIANT_COLUMN_DEFINITIONS } from './postgres-variant-columns'
import type { PostgresVariantColumnDefinition } from './postgres-variant-columns'
import { addPostgresClinicalVariantFilters } from './postgres-variant-clinical-filter-sql'
import { PostgresPanelIntervalResolver } from './postgres-panel-interval-resolver'
import { assertValidColumnFilterValues } from '../../../shared/filters/column-filter-validation'
import {
  buildPostgresVariantOrderTerms,
  decodeVariantCursor,
  encodeVariantCursor,
  keysetPredicate,
  keysetScope,
  orderTermsToSql,
  planKeyset,
  type PostgresOrderTerm
} from './postgres-variant-order'
import type { VariantPageRequest, VariantPageResult } from '../../../shared/types/variant-paging'
import { attachCaseTagIds, caseTagIdsSql } from '../../../shared/sql/variant-tag-ids-sql'
import { attachCasePhenotype, casePhenotypePageSql } from '../../../shared/sql/phenotype-score-sql'
import { attachFamilyCalls, familyCallsPageSql } from '../../../shared/sql/family-calls-sql'
import {
  attachCaseCompHetPhase,
  compHetPartnerGenes,
  type CompHetCandidateRow
} from '../../../shared/utils/phasing'

// The column definitions' SQL: `sv_length` sorts unsigned, as displayed.
const POSTGRES_BASE_SORT_COLUMNS: Record<string, string> = Object.fromEntries(
  Object.keys(BASE_SORTABLE_COLUMNS).map((k) => [k, POSTGRES_VARIANT_COLUMN_DEFINITIONS[k].sql])
)
POSTGRES_BASE_SORT_COLUMNS.id = 'v.id'
POSTGRES_BASE_SORT_COLUMNS.phenotype_score = POSTGRES_VARIANT_COLUMN_DEFINITIONS.phenotype_score.sql

const NUMERIC_VARIANT_FIELDS = new Set(
  'id,case_id,pos,end_pos,sv_length,dp,ad_ref,ad_alt,ps,internal_af,_sv_support,_sv_dr,_sv_dv,_sv_vaf,_sv_is_precise,_sv_stdev_len,_sv_stdev_pos,_cnv_copy_number,_cnv_gq,_cnv_ho_ref,_cnv_ho_alt,_str_ref_copies,_str_normal_max,_str_pathologic_min'.split(
    ','
  )
)

// prettier-ignore
const SV_PROJECTIONS = ['sv.support AS _sv_support', 'sv.dr AS _sv_dr', 'sv.dv AS _sv_dv', 'sv.vaf AS _sv_vaf', 'sv.sv_is_precise AS _sv_is_precise', 'sv.strand AS _sv_strand', 'sv.coverage AS _sv_coverage', 'sv.stdev_len AS _sv_stdev_len', 'sv.stdev_pos AS _sv_stdev_pos']
// prettier-ignore
const CNV_PROJECTIONS = ['cnv.copy_number AS _cnv_copy_number', 'cnv.copy_number_quality AS _cnv_gq', 'cnv.homozygosity_ref AS _cnv_ho_ref', 'cnv.homozygosity_alt AS _cnv_ho_alt']
// prettier-ignore
const STR_PROJECTIONS = ['str_ext.repeat_id AS _str_repeat_id', 'str_ext.repeat_unit AS _str_repeat_unit', 'str_ext.variant_catalog_id AS _str_variant_catalog_id', 'str_ext.display_repeat_unit AS _str_display_ru', 'str_ext.ref_copies AS _str_ref_copies', 'str_ext.alt_copies AS _str_alt_copies', 'str_ext.str_status AS _str_status', 'str_ext.normal_max AS _str_normal_max', 'str_ext.pathologic_min AS _str_pathologic_min', 'str_ext.disease AS _str_disease', 'str_ext.inheritance_mode AS _str_inheritance_mode', 'str_ext.rank_score AS _str_rank_score']

function searchTokens(query: string): string[] {
  return query.trim().split(/\s+/)
}

// Dots stay: the 'simple' parser keeps them inside a lexeme ('007294.4').
function toPrefixTsQuery(query: string): string {
  return searchTokens(query)
    .filter((token) => !HGVS_TOKEN.test(token))
    .map((token) => token.replace(/[^A-Za-z0-9_.]/g, ''))
    .filter((token) => token.length > 0)
    .map((token) => `${token}:*`)
    .join(' & ')
}

function emitCaseSearchTermSql(
  term: string,
  schemaName: string,
  addParam: (value: unknown) => string
): string {
  const coordMatch = term.match(/^(?:chr)?(\d{1,2}|X|Y|MT?):(\d+)$/i)
  if (coordMatch) {
    const names = contigQueryNames(coordMatch[1]).map(addParam).join(', ')
    return `(v.chr IN (${names}) AND v.pos = ${addParam(Number(coordMatch[2]))})`
  }
  const tokens = searchTokens(term)
  const hgvsTokens = tokens.filter((t) => HGVS_TOKEN.test(t))
  const nonHgvsQuery = tokens.filter((t) => !HGVS_TOKEN.test(t)).join(' ')
  const conditions: string[] = []

  for (const hgvs of hgvsTokens) {
    conditions.push(`COALESCE(${hgvsSearchSql('v', hgvs, addParam)}, FALSE)`)
  }

  const tsQuery = toPrefixTsQuery(nonHgvsQuery)
  if (tsQuery !== '') {
    const tsParam = addParam(tsQuery)
    conditions.push(`(
        v.search_document @@ to_tsquery('simple', ${tsParam})
        OR EXISTS (
          SELECT 1 FROM ${schemaName}."variant_sv" sv_search
          WHERE sv_search.variant_id = v.id
            AND sv_search.search_document @@ to_tsquery('simple', ${tsParam})
        )
        OR EXISTS (
          SELECT 1 FROM ${schemaName}."variant_str" str_search
          WHERE str_search.variant_id = v.id
            AND str_search.search_document @@ to_tsquery('simple', ${tsParam})
        )
      )`)
  }

  if (conditions.length === 0) return 'TRUE'
  return conditions.length === 1 ? conditions[0] : `(${conditions.join(' AND ')})`
}

export const toPrefixTsQueryForTest = toPrefixTsQuery

export function normalizeVariantRow(row: Record<string, unknown>): Variant {
  const normalized: Record<string, unknown> = { ...row }
  for (const field of NUMERIC_VARIANT_FIELDS) {
    const value = normalized[field]
    if (typeof value === 'string') normalized[field] = Number(value)
  }
  return normalized as unknown as Variant
}

function isNonEmptyArray(value: unknown): value is unknown[] {
  return Array.isArray(value) && value.length > 0
}

export interface PostgresVariantQueryParts {
  fromAndWhereSql: string
  orderBySql: string
  orderTerms: PostgresOrderTerm[]
  params: unknown[]
  projections: string[]
}

export function buildPostgresVariantQueryParts(
  filter: VariantFilter,
  schemaName: string,
  sortBy?: SortItem[],
  carrierTotals?: string // cached denominators (postgres-carrier-totals.ts), else computed here
): PostgresVariantQueryParts {
  assertSupportedPostgresVariantFilter(filter)

  const whereParts: string[] = []
  const params: unknown[] = []
  const addParam = (value: unknown): string => {
    params.push(value)
    return `$${params.length}`
  }
  const addWhere = (sql: string): void => {
    whereParts.push(sql)
  }

  const caseIdParam = addParam(filter.case_id)
  addWhere(`v.case_id = ${caseIdParam}`)

  const exactVariantType = filter.exact_variant_type === true
  if (filter.variant_type !== undefined && filter.variant_type !== '') {
    if (filter.variant_type === 'snv' && !exactVariantType) {
      addWhere("v.variant_type IN ('snv', 'indel')")
    } else {
      addWhere(`v.variant_type = ${addParam(filter.variant_type)}`)
    }
  }

  if (filter.gene_symbol !== undefined && filter.gene_symbol !== '') {
    addWhere(`v.gene_symbol ILIKE ${addParam(`%${filter.gene_symbol}%`)}`)
  }

  const ranks = carrierRanks('v', (table) => `${schemaName}."${table}"`)
  const severityTarget = (key: 'consequence' | 'clinvar'): SeverityFilterTarget => ({
    column: `v.${key}`,
    rank: key === 'clinvar' ? ranks.clinvar : ranks.impact,
    bind: (value) => addParam(value)
  })
  if (isNonEmptyArray(filter.consequences)) {
    addWhere(
      severityFilterSql('consequence', filter.consequences, severityTarget('consequence')) as string
    )
  } else if (filter.consequence !== undefined && filter.consequence !== '') {
    addWhere(`v.consequence = ${addParam(filter.consequence)}`)
  }

  if (isNonEmptyArray(filter.funcs)) {
    addWhere(`v.func IN (${filter.funcs.map((value) => addParam(value)).join(', ')})`)
  }

  if (isNonEmptyArray(filter.clinvars)) {
    addWhere(severityFilterSql('clinvar', filter.clinvars, severityTarget('clinvar')) as string)
  }

  if (filter.gnomad_af_max !== undefined) {
    addWhere(`(v.gnomad_af IS NULL OR v.gnomad_af <= ${addParam(filter.gnomad_af_max)})`)
  }

  if (filter.cadd_min !== undefined) {
    addWhere(`(v.cadd IS NULL OR v.cadd >= ${addParam(filter.cadd_min)})`)
  }

  const {
    carriers,
    frequency: internalAfExpression,
    totalsJoin
  } = caseCarrierFrequencySql((table) => `${schemaName}."${table}"`, caseIdParam, carrierTotals)

  if (filter.max_internal_af !== undefined && filter.max_internal_af > 0) {
    addWhere(`COALESCE(${internalAfExpression}, 0) <= ${addParam(filter.max_internal_af)}`)
  }
  if (filter.carrier_count_max !== undefined && filter.carrier_count_max >= 1) {
    addWhere(`COALESCE(${carriers}, 0) <= ${addParam(filter.carrier_count_max)}::bigint`)
  }

  const searchQuery = (filter.search_query ?? '').trim()
  if (searchQuery !== '') {
    const searchSql = booleanSearchSql(searchQuery, (term) =>
      emitCaseSearchTermSql(term, schemaName, addParam)
    )
    if (searchSql !== '' && searchSql !== 'TRUE') addWhere(searchSql)
  }

  if (filter.chr !== undefined && filter.chr !== '') {
    addWhere(`v.chr IN (${contigQueryNames(filter.chr).map(addParam).join(', ')})`)
  }
  if (filter.pos !== undefined) addWhere(`v.pos = ${addParam(filter.pos)}`)
  if (filter.ref !== undefined && filter.ref !== '') addWhere(`v.ref = ${addParam(filter.ref)}`)
  if (filter.alt !== undefined && filter.alt !== '') addWhere(`v.alt = ${addParam(filter.alt)}`)

  // Stored phenotype score (`ps.score`) for sorts and filters only (#Perf3).
  const needsPhenotypeJoin =
    filter.column_filters?.phenotype_score !== undefined ||
    (sortBy?.some((s) => s.key === 'phenotype_score') ?? false)
  const joins = [totalsJoin]
  if (needsPhenotypeJoin) {
    joins.push(
      `LEFT JOIN ${schemaName}."case_phenotype_scores" ps ON ps.case_id = v.case_id AND ps.gene_symbol = v.gene_symbol`
    )
  }
  const projections = [`v.*`, `${internalAfExpression} AS internal_af`]

  if (filter.variant_type === 'sv' || hasPostgresColumnFilterPrefix(filter, 'sv.')) {
    joins.push(`LEFT JOIN ${schemaName}."variant_sv" sv ON sv.variant_id = v.id`)
  }
  if (filter.variant_type === 'sv') projections.push(...SV_PROJECTIONS)
  if (filter.variant_type === 'cnv' || hasPostgresColumnFilterPrefix(filter, 'cnv.')) {
    joins.push(`LEFT JOIN ${schemaName}."variant_cnv" cnv ON cnv.variant_id = v.id`)
  }
  if (filter.variant_type === 'cnv') projections.push(...CNV_PROJECTIONS)
  if (filter.variant_type === 'str' || hasPostgresColumnFilterPrefix(filter, 'str.')) {
    joins.push(`LEFT JOIN ${schemaName}."variant_str" str_ext ON str_ext.variant_id = v.id`)
  }
  if (filter.variant_type === 'str') projections.push(...STR_PROJECTIONS)

  addPostgresColumnFilters(filter, addParam, addWhere, ranks)
  const fromAndWhereSql = (): string => `FROM ${schemaName}."variants" v
      ${joins.join('\n')}
      WHERE ${whereParts.join('\n        AND ')}`
  // Last: candidate compound het counts the rows every other filter keeps (#579).
  addPostgresClinicalVariantFilters(filter, { schemaName, addParam, addWhere, fromAndWhereSql })

  const orderTerms = buildPostgresVariantOrderTerms(sortBy, POSTGRES_BASE_SORT_COLUMNS, ranks)
  return {
    fromAndWhereSql: fromAndWhereSql(),
    orderBySql: orderTermsToSql(orderTerms),
    orderTerms,
    params,
    projections
  }
}

function assertSupportedPostgresVariantFilter(filter: VariantFilter): void {
  assertValidColumnFilterValues(filter.column_filters)
}

export class PostgresVariantReadRepository {
  private readonly schemaName: string
  private readonly schema: string
  private readonly panelIntervals: PostgresPanelIntervalResolver

  constructor(
    private readonly pool: Pick<Pool, 'query'>,
    schema: string,
    panelIntervals?: PostgresPanelIntervalResolver
  ) {
    this.schema = schema
    this.schemaName = quoteIdentifier(schema)
    this.panelIntervals = panelIntervals ?? new PostgresPanelIntervalResolver(pool, schema)
  }

  async getVariantTypeCounts(caseId: number): Promise<Record<string, number>> {
    const result = await runNamed<{ variant_type: string; count: unknown }>(this.pool as Pool, {
      name: 'variants:type_counts:v1',
      text: `SELECT variant_type, COUNT(*)::int AS count FROM ${this.schemaName}."variants" WHERE case_id = $1 GROUP BY variant_type ORDER BY variant_type`,
      values: [caseId],
      schema: this.schema
    })
    const counts: Record<string, number> = {}
    for (const row of result.rows as Array<{ variant_type: string; count: unknown }>) {
      counts[row.variant_type] = toNumber(row.count)
    }
    return counts
  }

  async getVariantTypesPresent(
    scope: { caseId: number } | { caseIds: number[] }
  ): Promise<string[]> {
    const caseIds = 'caseId' in scope ? [scope.caseId] : scope.caseIds
    if (caseIds.length === 0) return []
    const isSingle = caseIds.length === 1
    const result = await runNamedDynamic<{ variant_type: string }>(this.pool as Pool, {
      baseName: 'variants:types_present',
      text: `SELECT DISTINCT variant_type FROM ${this.schemaName}."variants" WHERE ${isSingle ? 'case_id = $1' : 'case_id = ANY($1::bigint[])'} AND variant_type IS NOT NULL ORDER BY variant_type`,
      values: [isSingle ? caseIds[0] : caseIds],
      schema: this.schema
    })
    return (result.rows as Array<{ variant_type: string }>).map((row) => row.variant_type)
  }

  async getGeneSymbols(caseId: number, query: string, limit: number): Promise<string[]> {
    const result = await runNamed<{ gene_symbol: string }>(this.pool as Pool, {
      name: 'variants:gene_symbols:v1',
      text: `SELECT DISTINCT gene_symbol FROM ${this.schemaName}."variants" WHERE case_id = $1 AND gene_symbol IS NOT NULL AND gene_symbol ILIKE $2 ORDER BY gene_symbol LIMIT $3`,
      values: [caseId, `${query}%`, limit],
      schema: this.schema
    })
    return result.rows.map((row) => row.gene_symbol)
  }

  async searchVariants(caseId: number, query: string, limit: number): Promise<Variant[]> {
    if (
      toPrefixTsQuery(query) === '' &&
      !searchTokens(query).some((t) => HGVS_TOKEN.test(t)) &&
      !/\b(AND|OR|NOT)\b/.test(query)
    ) {
      return []
    }
    const result = await this.queryVariants(
      { case_id: caseId, search_query: query },
      limit,
      0,
      undefined,
      true,
      false
    )
    return result.data
  }

  async queryVariants(
    requestedFilter: VariantFilter,
    limit: number,
    offset: number = 0,
    sortBy?: SortItem[],
    skipCount?: boolean,
    includeUnfilteredCount?: boolean,
    page?: VariantPageRequest
  ): Promise<PaginatedResult<Variant> & { unfiltered_count?: number } & VariantPageResult> {
    const filter = await this.panelIntervals.resolveCaseFilter(requestedFilter)
    const totals = await carrierTotalsSql(this.pool, this.schema)
    const { fromAndWhereSql, orderBySql, orderTerms, params, projections } =
      buildPostgresVariantQueryParts(filter, this.schemaName, sortBy, totals)

    let totalCount = 0
    if (skipCount !== true) {
      const countResult = await runNamedDynamic<{ count: unknown }>(this.pool as Pool, {
        baseName: 'variants:query_count',
        text: `SELECT COUNT(*)::int AS count ${fromAndWhereSql}`,
        values: params,
        schema: this.schema
      })
      totalCount = toNumber((countResult.rows[0] as { count?: unknown } | undefined)?.count)
    }

    const plan = planKeyset(orderTerms)
    const scope = plan !== null ? keysetScope(plan, filter) : ''
    const seek =
      plan !== null && page?.cursor !== undefined
        ? decodeVariantCursor(plan, scope, page.cursor)
        : null
    const dataParams = [...params]
    const seekSql =
      plan !== null && seek !== null
        ? `AND ${keysetPredicate(plan, seek, (value) => {
            dataParams.push(value)
            return `$${dataParams.length}`
          })}`
        : ''
    dataParams.push(limit, seek !== null ? 0 : offset)
    const dataResult = await runNamedDynamic<Record<string, unknown>>(this.pool as Pool, {
      baseName: seek !== null ? 'variants:query_page_keyset' : 'variants:query_page',
      text: `SELECT ${projections.join(', ')} ${fromAndWhereSql} ${seekSql} ${orderBySql} LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
      values: dataParams,
      schema: this.schema
    })

    let unfilteredCount: number | undefined
    if (includeUnfilteredCount === true) {
      const result = await this.pool.query(
        `SELECT COALESCE(NULLIF((SELECT variant_count FROM ${this.schemaName}."cases" WHERE id = $1), 0), (SELECT COUNT(*)::int FROM ${this.schemaName}."variants" WHERE case_id = $1)) AS count`,
        [filter.case_id]
      )
      unfilteredCount = toNumber((result.rows[0] as { count?: unknown } | undefined)?.count)
    }

    const rows = dataResult.rows as Array<Record<string, unknown>>
    const lastRow = rows[rows.length - 1]
    const nextCursor =
      page !== undefined && plan !== null && lastRow !== undefined && rows.length === limit
        ? encodeVariantCursor(plan, scope, lastRow)
        : undefined

    const data = rows.map((row) => normalizeVariantRow(row))
    if (data.length > 0) {
      const table = (name: string): string => `${this.schemaName}."${name}"`
      const ids = data.map((v) => v.id)
      const allOnFirstPage =
        seek === null &&
        offset === 0 &&
        (skipCount === true ? data.length < limit : data.length >= totalCount)
      const phasingGenes =
        filter.consider_phasing === true ? compHetPartnerGenes(data, filter, allOnFirstPage) : []
      const partnerParts =
        phasingGenes !== null && phasingGenes.length > 0
          ? buildPostgresVariantQueryParts(
              { ...filter, inheritance_modes: undefined },
              this.schemaName,
              undefined,
              totals
            )
          : null
      const [tagResult, phenoResult, famResult, partnerResult] = await Promise.all([
        this.pool.query(caseTagIdsSql('postgres', table), [filter.case_id, ids]),
        this.pool.query(casePhenotypePageSql('postgres', table), [filter.case_id, ids]),
        filter.analysis_group_id !== undefined
          ? this.pool.query(familyCallsPageSql('postgres', table), [
              filter.analysis_group_id,
              filter.case_id,
              ids
            ])
          : Promise.resolve(null),
        partnerParts !== null && phasingGenes !== null
          ? this.pool.query(
              `SELECT v.chr, v.pos, v.ref, v.alt, v.gene_symbol, v.gt_num, v.ps ${partnerParts.fromAndWhereSql} AND v.gene_symbol = ANY($${partnerParts.params.length + 1}::text[])`,
              [...partnerParts.params, phasingGenes]
            )
          : Promise.resolve(null)
      ])
      attachCaseTagIds(data, tagResult.rows)
      attachCasePhenotype(data, phenoResult.rows)
      if (famResult !== null) attachFamilyCalls(data, famResult.rows)
      if (filter.consider_phasing === true) {
        attachCaseCompHetPhase(
          data,
          phasingGenes === null ? data : ((partnerResult?.rows ?? []) as CompHetCandidateRow[])
        )
      }
    }

    return {
      data,
      total_count: totalCount,
      ...(seek !== null ? { paging: 'keyset' as const } : {}),
      ...(nextCursor !== undefined ? { next_cursor: nextCursor } : {}),
      ...(unfilteredCount !== undefined ? { unfiltered_count: unfilteredCount } : {})
    }
  }

  /** Per-case filter options from materialised `cohort_column_meta` cache. */
  async getFilterOptions(caseId: number): Promise<FilterOptions> {
    const result = await runNamed<ColumnMetaRow>(this.pool as Pool, {
      name: 'variants:filter_options_per_case:v1',
      text: `SELECT column_name, min_value, max_value, distinct_count, distinct_values FROM ${this.schemaName}."cohort_column_meta" WHERE case_id = $1`,
      values: [caseId],
      schema: this.schema
    })
    return reshapeFilterOptions(result.rows)
  }

  async getColumnMeta(
    scope: { caseId: number } | { caseIds: number[] },
    columnKey: string
  ): Promise<ColumnFilterMeta> {
    const definition = POSTGRES_VARIANT_COLUMN_DEFINITIONS[columnKey]
    if (definition === undefined) {
      return { key: columnKey, dataType: 'text', distinctCount: 0 }
    }
    if ('caseId' in scope && !columnKey.includes('.')) {
      return this.getPerCaseColumnMeta(scope.caseId, definition)
    }
    const caseIds = 'caseId' in scope ? [scope.caseId] : scope.caseIds
    if (caseIds.length === 0) {
      return {
        key: columnKey,
        dataType: definition.kind === 'numeric' ? 'numeric' : 'text',
        distinctCount: 0
      }
    }
    const fn =
      definition.kind === 'numeric' ? getNumericColumnMetaLive : getCategoricalColumnMetaLive
    return fn(this.pool as Pool, this.schema, this.schemaName, caseIds, definition)
  }

  /** Single base column for one case, read from the cohort_column_meta cache. */
  private async getPerCaseColumnMeta(
    caseId: number,
    definition: PostgresVariantColumnDefinition
  ): Promise<ColumnFilterMeta> {
    const result = await runNamed<ColumnMetaRow>(this.pool as Pool, {
      name: 'variants:column_meta_per_case:v1',
      text: `SELECT column_name, min_value, max_value, distinct_count, distinct_values FROM ${this.schemaName}."cohort_column_meta" WHERE case_id = $1 AND column_name = $2`,
      values: [caseId, definition.key],
      schema: this.schema
    })
    const row = result.rows[0]
    const isNumeric = definition.kind === 'numeric'
    return row === undefined
      ? emptyColumnMeta(definition.key, isNumeric)
      : columnMetaRowToFilterMeta(definition.key, isNumeric, row)
  }
}
