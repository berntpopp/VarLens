import type { Pool, PoolClient } from 'pg'
import QueryStream from 'pg-query-stream'

import type { ColumnFilter, ColumnFilterMeta } from '../../../shared/types/column-filters'
import type {
  CohortCarrier,
  CohortPaginatedResult,
  CohortSearchParams,
  CohortSummary,
  CohortVariant,
  GeneBurden
} from '../../../shared/types/cohort'
import { mainLogger } from '../../services/MainLogger'
import { getGeneReferenceDb } from '../../database/geneReferenceLoader'
import {
  prepareCohortRead,
  readCohortSummaryStatus,
  type CohortReadWarnings
} from './cohort-read-freshness'
import { quoteIdentifier } from './identifiers'
import { runNamed, runNamedDynamic } from './named-query'
import { POSTGRES_VARIANT_COLUMN_DEFINITIONS } from './postgres-variant-columns'
import {
  buildSummaryCountSql,
  buildSummaryPageSql,
  buildSummaryQueryParts
} from './postgres-cohort-summary-query'

type CohortPool = Pick<Pool, 'query' | 'connect'>
type CohortClient = Pick<PoolClient, 'query' | 'release'>

type Queryable = Pick<Pool, 'query'>

type CohortCarrierWithDepth = CohortCarrier & {
  gq?: number | null
  dp?: number | null
}

interface GenomicInterval {
  chr: string
  start: number
  end: number
}

type PanelIntervalResolver = (
  panelIds: number[],
  genomeBuild: string,
  paddingBp: number,
  chrPrefix: boolean
) => Promise<GenomicInterval[]>

const SORTABLE_COLUMNS: Record<string, string> = {
  chr: 'chr',
  pos: 'pos',
  gene_symbol: 'gene_symbol',
  cdna: 'cdna',
  aa_change: 'aa_change',
  carrier_count: 'carrier_count',
  cohort_frequency: 'cohort_frequency',
  het_count: 'het_count',
  hom_count: 'hom_count',
  consequence: 'consequence',
  func: 'func',
  clinvar: 'clinvar',
  gnomad_af: 'gnomad_af',
  cadd_phred: 'cadd_phred',
  transcript: 'transcript'
}

const NUMERIC_COLUMNS = new Set([
  'pos',
  'carrier_count',
  'cohort_frequency',
  'het_count',
  'hom_count',
  'gnomad_af',
  'cadd_phred'
])

const COLUMN_META_KEYS = [
  'chr',
  'pos',
  'gene_symbol',
  'carrier_count',
  'cohort_frequency',
  'het_count',
  'hom_count',
  'consequence',
  'func',
  'clinvar',
  'gnomad_af',
  'cadd_phred',
  'transcript'
]

/**
 * Filter-UI key → stored column on `cohort_variant_summary`. Every key is a
 * physical column on the summary table; `cadd_phred` is the only rename
 * (stored as `cadd`). Used by the cohort-view getColumnMeta read (C4 Step 2) so
 * COUNT(DISTINCT)/MIN/MAX run against the already-deduped summary rows rather
 * than a live GROUP BY (Pass-3 HIGH #3 — SUM across cohort_column_meta would
 * overcount).
 */
const COLUMN_META_SUMMARY_COLUMNS: Record<string, string> = {
  chr: 'chr',
  pos: 'pos',
  gene_symbol: 'gene_symbol',
  carrier_count: 'carrier_count',
  cohort_frequency: 'cohort_frequency',
  het_count: 'het_count',
  hom_count: 'hom_count',
  consequence: 'consequence',
  func: 'func',
  clinvar: 'clinvar',
  gnomad_af: 'gnomad_af',
  cadd_phred: 'cadd',
  transcript: 'transcript'
}

type CohortColumnFilterLocation = 'where' | 'having'

interface CohortColumnFilterDefinition {
  sql: string
  dataType: 'numeric' | 'text'
  location: CohortColumnFilterLocation
  extensionPrefix?: 'sv.' | 'cnv.' | 'str.'
}

const HET_COUNT_SQL =
  "COUNT(DISTINCT v.case_id) FILTER (WHERE v.gt_num IN ('0/1', '1/0', '0|1', '1|0'))"
const HOM_COUNT_SQL = "COUNT(DISTINCT v.case_id) FILTER (WHERE v.gt_num IN ('1/1', '1|1'))"

const COHORT_COLUMN_FILTER_DEFINITIONS: Record<string, CohortColumnFilterDefinition> = {
  chr: { sql: 'v.chr', dataType: 'text', location: 'where' },
  pos: { sql: 'v.pos', dataType: 'numeric', location: 'where' },
  gene_symbol: { sql: 'v.gene_symbol', dataType: 'text', location: 'where' },
  consequence: { sql: 'v.consequence', dataType: 'text', location: 'where' },
  func: { sql: 'v.func', dataType: 'text', location: 'where' },
  clinvar: { sql: 'v.clinvar', dataType: 'text', location: 'where' },
  gnomad_af: { sql: 'v.gnomad_af', dataType: 'numeric', location: 'where' },
  cadd_phred: { sql: 'v.cadd', dataType: 'numeric', location: 'where' },
  transcript: { sql: 'v.transcript', dataType: 'text', location: 'where' },
  carrier_count: {
    sql: 'COUNT(DISTINCT v.case_id)',
    dataType: 'numeric',
    location: 'having'
  },
  cohort_frequency: {
    sql: '',
    dataType: 'numeric',
    location: 'having'
  },
  het_count: {
    sql: HET_COUNT_SQL,
    dataType: 'numeric',
    location: 'having'
  },
  hom_count: {
    sql: HOM_COUNT_SQL,
    dataType: 'numeric',
    location: 'having'
  }
}

for (const [key, definition] of Object.entries(POSTGRES_VARIANT_COLUMN_DEFINITIONS)) {
  if (!key.includes('.')) continue
  COHORT_COLUMN_FILTER_DEFINITIONS[key] = {
    sql: definition.sql,
    dataType: definition.kind === 'numeric' ? 'numeric' : 'text',
    location: 'where',
    extensionPrefix: key.startsWith('sv.') ? 'sv.' : key.startsWith('cnv.') ? 'cnv.' : 'str.'
  }
}

const COHORT_COLUMN_FILTER_ORDER = [
  'chr',
  'pos',
  'gene_symbol',
  'consequence',
  'func',
  'clinvar',
  'gnomad_af',
  'cadd_phred',
  'transcript',
  'carrier_count',
  'cohort_frequency',
  'het_count',
  'hom_count'
]

function toNumber(value: unknown): number {
  if (typeof value === 'number') return value
  if (typeof value === 'string') return Number(value)
  return 0
}

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const numberValue = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numberValue) ? numberValue : null
}

function isNonEmptyArray(value: unknown): value is unknown[] {
  return Array.isArray(value) && value.length > 0
}

function mergeOverlappingIntervals(intervals: GenomicInterval[]): GenomicInterval[] {
  if (intervals.length === 0) return []

  const sorted = [...intervals].sort((a, b) => {
    const chrCompare = a.chr.localeCompare(b.chr, undefined, { numeric: true })
    return chrCompare !== 0 ? chrCompare : a.start - b.start
  })

  const merged: GenomicInterval[] = []
  for (const interval of sorted) {
    const previous = merged[merged.length - 1]
    if (
      previous !== undefined &&
      previous.chr === interval.chr &&
      interval.start <= previous.end + 1
    ) {
      previous.end = Math.max(previous.end, interval.end)
    } else {
      merged.push({ ...interval })
    }
  }
  return merged
}

function withoutActivePanelFields(params: CohortSearchParams): CohortSearchParams {
  const rest = { ...params }
  delete rest.active_panel_ids
  delete rest.panel_padding_bp
  return rest
}

export class PostgresCohortRepository {
  private readonly schema: string
  private readonly schemaName: string
  private readonly panelIntervalResolver: PanelIntervalResolver
  private columnMetaCache: ColumnFilterMeta[] | null = null

  constructor(
    private readonly pool: CohortPool,
    schema: string,
    panelIntervalResolver?: PanelIntervalResolver
  ) {
    this.schema = schema
    this.schemaName = quoteIdentifier(schema)
    this.panelIntervalResolver = panelIntervalResolver ?? this.resolvePanelIntervals.bind(this)
  }

  private tbl(table: string): string {
    return `${this.schemaName}."${table}"`
  }

  async queryVariants(params: CohortSearchParams): Promise<CohortPaginatedResult> {
    const resolvedParams = await this.resolvePanelParams(params)
    this.assertSupportedColumnFilters(resolvedParams)
    const totalCases = await this.getTotalCases(this.pool, resolvedParams)

    // C4: prefer the materialised cohort_variant_summary page query. Falls back
    // to live aggregation when buildSummaryQueryParts reports the predicate set
    // is not materialisable (extension-table filters — Sprint B).
    const summaryResult = await this.querySummaryPage(resolvedParams, totalCases)
    if (summaryResult !== null) return summaryResult

    return this.queryLivePage(resolvedParams, totalCases)
  }

  /**
   * C5 (PR3-17): reconcile the materialised summary before serving, then run the
   * page read. Returns the warnings to merge into the IPC response (staleSummary
   * when a large cohort is served stale while a background rebuild runs).
   */
  async queryVariantsWithStaleness(
    params: CohortSearchParams
  ): Promise<CohortPaginatedResult & { warnings?: CohortReadWarnings }> {
    const { warnings } = await prepareCohortRead({ pool: this.pool, schema: this.schema })
    const result = await this.queryVariants(params)
    return warnings === undefined ? result : { ...result, warnings }
  }

  /**
   * C5 (PR3-17): cohort_summary_state read in the existing IPC shape
   * { is_stale, last_rebuilt_at:number }. Replaces the hardcoded handler stub.
   */
  async getSummaryStatus(): Promise<{ is_stale: boolean; last_rebuilt_at: number }> {
    return readCohortSummaryStatus({ pool: this.pool, schema: this.schema })
  }

  /**
   * C4 summary-page read. Builds predicate parts against `cohort_variant_summary`
   * via buildSummaryQueryParts and runs count + page in one materialised path.
   * Returns null when the predicate set is not materialisable so the caller can
   * fall back to live aggregation.
   */
  private async querySummaryPage(
    params: CohortSearchParams,
    totalCases: number
  ): Promise<CohortPaginatedResult | null> {
    const summary = buildSummaryQueryParts(params, totalCases)
    if (summary.unavailable) return null

    const { whereParts, orderBy, values } = summary.parts
    const table = this.tbl('cohort_variant_summary')

    let totalCount = 0
    if (params._count_needed !== false) {
      const countResult = await runNamedDynamic<{ total_count?: unknown }>(this.pool as Pool, {
        baseName: 'cohort:summary_count',
        text: buildSummaryCountSql(table, whereParts),
        values,
        schema: this.schema
      })
      totalCount = toNumber(
        (countResult.rows[0] as { total_count?: unknown } | undefined)?.total_count
      )
    }

    const limit = params.limit ?? 50
    const offset = params.offset ?? 0
    const dataValues = [...values, limit, offset]
    const dataResult = await runNamedDynamic<Record<string, unknown>>(this.pool as Pool, {
      baseName: 'cohort:summary_page',
      text: buildSummaryPageSql(
        table,
        whereParts,
        orderBy,
        totalCases,
        dataValues.length - 1,
        dataValues.length
      ),
      values: dataValues,
      schema: this.schema
    })

    return {
      data: (dataResult.rows as Array<Record<string, unknown>>).map((row) =>
        this.toCohortVariant(row, totalCases)
      ),
      total_count: totalCount
    }
  }

  /** Live-aggregation page query (fallback path when the summary is unavailable). */
  private async queryLivePage(
    resolvedParams: CohortSearchParams,
    totalCases: number
  ): Promise<CohortPaginatedResult> {
    const queryParts = this.buildQueryParts(resolvedParams, totalCases)

    let totalCount = 0
    if (resolvedParams._count_needed !== false) {
      const countResult = await this.pool.query(
        `SELECT COUNT(*)::bigint AS total_count FROM (
           ${this.buildGroupedSelect(queryParts, totalCases, false)}
         ) grouped_variants`,
        queryParts.params
      )
      totalCount = toNumber(
        (countResult.rows[0] as { total_count?: unknown } | undefined)?.total_count
      )
    }

    const limit = resolvedParams.limit ?? 50
    const offset = resolvedParams.offset ?? 0
    const dataParams = [...queryParts.params, limit, offset]
    const dataResult = await this.pool.query(
      `${this.buildGroupedSelect(queryParts, totalCases, true)}
       ${this.buildOrderBy(resolvedParams)}
       LIMIT $${dataParams.length - 1}
       OFFSET $${dataParams.length}`,
      dataParams
    )

    return {
      data: (dataResult.rows as Array<Record<string, unknown>>).map((row) =>
        this.toCohortVariant(row, totalCases)
      ),
      total_count: totalCount
    }
  }

  async getSummary(): Promise<CohortSummary> {
    const result = await this.pool.query(
      `SELECT
         (SELECT COUNT(*)::bigint FROM ${this.schemaName}."cases") AS total_cases,
         (SELECT COUNT(*)::bigint FROM ${this.schemaName}."variants") AS total_variants,
         (
           SELECT COUNT(*)::bigint
           FROM (
             SELECT 1
             FROM ${this.schemaName}."variants" v
             GROUP BY v.chr, v.pos, v.ref, v.alt
           ) unique_variants
         ) AS unique_variants,
         (
           SELECT COUNT(DISTINCT v.gene_symbol)::bigint
           FROM ${this.schemaName}."variants" v
           WHERE v.gene_symbol IS NOT NULL
         ) AS genes_with_variants,
         (
           SELECT COUNT(*)::bigint
           FROM ${this.schemaName}."variant_annotations" va
           WHERE va.starred = 1
         ) AS starred_variants,
         (
           SELECT COUNT(*)::bigint
           FROM ${this.schemaName}."variant_annotations" va
           WHERE va.acmg_classification = 'Pathogenic'
         ) AS pathogenic,
         (
           SELECT COUNT(*)::bigint
           FROM ${this.schemaName}."variant_annotations" va
           WHERE va.acmg_classification = 'Likely pathogenic'
         ) AS likely_pathogenic,
         (
           SELECT COUNT(*)::bigint
           FROM ${this.schemaName}."variant_annotations" va
           WHERE va.acmg_classification = 'Uncertain significance'
         ) AS vus,
         (
           SELECT COUNT(*)::bigint
           FROM ${this.schemaName}."variant_annotations" va
           WHERE va.acmg_classification = 'Likely benign'
         ) AS likely_benign,
         (
           SELECT COUNT(*)::bigint
           FROM ${this.schemaName}."variant_annotations" va
           WHERE va.acmg_classification = 'Benign'
         ) AS benign`
    )
    const row = (result.rows[0] ?? {}) as Record<string, unknown>
    const totalCases = toNumber(row.total_cases)
    const totalVariants = toNumber(row.total_variants)

    return {
      total_cases: totalCases,
      total_variants: totalVariants,
      unique_variants: toNumber(row.unique_variants),
      avg_variants_per_case: totalCases > 0 ? totalVariants / totalCases : 0,
      genes_with_variants: toNumber(row.genes_with_variants),
      starred_variants: toNumber(row.starred_variants),
      acmg_counts: {
        pathogenic: toNumber(row.pathogenic),
        likely_pathogenic: toNumber(row.likely_pathogenic),
        vus: toNumber(row.vus),
        likely_benign: toNumber(row.likely_benign),
        benign: toNumber(row.benign)
      }
    }
  }

  async getCarriers(
    chr: string,
    pos: number,
    ref: string,
    alt: string
  ): Promise<CohortCarrierWithDepth[]> {
    const result = await this.pool.query(
      `SELECT
         v.case_id,
         c.name AS case_name,
         MAX(v.gt_num) AS gt_num,
         MAX(v.gq) AS gq,
         MAX(v.dp) AS dp
       FROM ${this.schemaName}."variants" v
       JOIN ${this.schemaName}."cases" c ON c.id = v.case_id
       WHERE v.chr = $1 AND v.pos = $2 AND v.ref = $3 AND v.alt = $4
       GROUP BY v.case_id, c.name
       ORDER BY c.name`,
      [chr, pos, ref, alt]
    )

    return (result.rows as Array<Record<string, unknown>>).map((row) => ({
      case_id: toNumber(row.case_id),
      case_name: String(row.case_name ?? ''),
      gt_num: String(row.gt_num ?? ''),
      gq: toNullableNumber(row.gq),
      dp: toNullableNumber(row.dp)
    }))
  }

  async getGeneBurden(): Promise<GeneBurden[]> {
    const result = await this.pool.query(
      `SELECT
         v.gene_symbol,
         COUNT(*)::bigint AS variant_count,
         COUNT(DISTINCT (v.chr, v.pos, v.ref, v.alt))::bigint AS unique_variant_count,
         COUNT(DISTINCT v.case_id)::bigint AS affected_case_count,
         (SELECT COUNT(*)::bigint FROM ${this.schemaName}."cases") AS total_cases
       FROM ${this.schemaName}."variants" v
       WHERE v.gene_symbol IS NOT NULL AND v.gene_symbol <> ''
       GROUP BY v.gene_symbol
       ORDER BY affected_case_count DESC, variant_count DESC`
    )

    return (result.rows as Array<Record<string, unknown>>).map((row) => ({
      gene_symbol: String(row.gene_symbol ?? ''),
      variant_count: toNumber(row.variant_count),
      unique_variant_count: toNumber(row.unique_variant_count),
      affected_case_count: toNumber(row.affected_case_count),
      total_cases: toNumber(row.total_cases)
    }))
  }

  /**
   * Cohort-view per-column metadata (C4 Step 2). Reads COUNT(DISTINCT)/MIN/MAX
   * directly from the already-deduped `cohort_variant_summary` table — mirroring
   * SQLite cohort.ts:getColumnMeta. Aggregating across `cohort_column_meta`
   * would SUM per-case distinct counts and overcount (Pass-3 HIGH #3), so the
   * cohort path reads the summary table, not the per-case meta cache.
   */
  async getColumnMeta(): Promise<ColumnFilterMeta[]> {
    if (this.columnMetaCache !== null) return this.columnMetaCache

    const meta: ColumnFilterMeta[] = []
    const selectParts = COLUMN_META_KEYS.flatMap((key) => {
      const sqlColumn = COLUMN_META_SUMMARY_COLUMNS[key]
      const parts = [`COUNT(DISTINCT ${sqlColumn})::bigint AS cnt_${key}`]
      if (NUMERIC_COLUMNS.has(key)) {
        parts.push(`MIN(${sqlColumn}) AS min_${key}`, `MAX(${sqlColumn}) AS max_${key}`)
      }
      return parts
    })
    const aggregateResult = await runNamed<Record<string, unknown>>(this.pool as Pool, {
      name: 'cohort:column_meta_agg:v1',
      text: `SELECT ${selectParts.join(', ')} FROM ${this.tbl('cohort_variant_summary')}`,
      values: [],
      schema: this.schema
    })
    const aggregateRow = (aggregateResult.rows[0] ?? {}) as Record<string, unknown>
    const lowCardinalityColumns: Array<{ key: string; sqlColumn: string }> = []

    for (const key of COLUMN_META_KEYS) {
      const isNumeric = NUMERIC_COLUMNS.has(key)
      const sqlColumn = COLUMN_META_SUMMARY_COLUMNS[key]
      const entry: ColumnFilterMeta = {
        key,
        dataType: isNumeric ? 'numeric' : 'text',
        distinctCount: toNumber(aggregateRow[`cnt_${key}`])
      }
      if (isNumeric) {
        const min = toNullableNumber(aggregateRow[`min_${key}`])
        const max = toNullableNumber(aggregateRow[`max_${key}`])
        if (min !== null) entry.min = min
        if (max !== null) entry.max = max
      }
      if (entry.distinctCount > 0 && entry.distinctCount <= 50) {
        lowCardinalityColumns.push({ key, sqlColumn })
      }
      meta.push(entry)
    }

    if (lowCardinalityColumns.length > 0) {
      const unionParts = lowCardinalityColumns
        .map(
          ({ key, sqlColumn }) =>
            `SELECT '${key}' AS col_key, ${sqlColumn}::text AS value
             FROM ${this.tbl('cohort_variant_summary')}
             WHERE ${sqlColumn} IS NOT NULL
             GROUP BY ${sqlColumn}`
        )
        .join('\nUNION ALL\n')
      const valuesResult = await runNamedDynamic<{ col_key: string; value: unknown }>(
        this.pool as Pool,
        {
          baseName: 'cohort:column_meta_values',
          text: unionParts,
          values: [],
          schema: this.schema
        }
      )
      const valuesByKey = new Map<string, string[]>()
      for (const row of valuesResult.rows as Array<{ col_key: string; value: unknown }>) {
        const values = valuesByKey.get(row.col_key) ?? []
        values.push(String(row.value))
        valuesByKey.set(row.col_key, values)
      }
      for (const entry of meta) {
        const values = valuesByKey.get(entry.key)
        if (values !== undefined) entry.distinctValues = values.sort()
      }
    }

    this.columnMetaCache = meta
    return meta
  }

  async *streamCohortRows(params: CohortSearchParams): AsyncGenerator<Record<string, unknown>> {
    const resolvedParams = await this.resolvePanelParams(params)
    this.assertSupportedColumnFilters(resolvedParams)
    const totalCases = await this.getTotalCases(this.pool, resolvedParams)
    const queryParts = this.buildQueryParts(resolvedParams, totalCases)
    const limitOffset = this.buildOptionalLimitOffset(resolvedParams, queryParts.params)
    const client: CohortClient = await this.pool.connect()
    const stream = client.query(
      new QueryStream(
        `${this.buildGroupedSelect(queryParts, totalCases, true)}
         ${this.buildOrderBy(resolvedParams)}
         ${limitOffset.sql}`,
        limitOffset.params
      )
    ) as AsyncIterable<Record<string, unknown>>

    try {
      for await (const row of stream) {
        yield row
      }
    } finally {
      client.release()
    }
  }

  private async getTotalCases(pool: Queryable, params: CohortSearchParams = {}): Promise<number> {
    if (params.genome_build !== undefined && params.genome_build !== '') {
      const result = await pool.query(
        `SELECT COUNT(*)::bigint AS total_cases
         FROM ${this.schemaName}."cases"
         WHERE genome_build = $1`,
        [params.genome_build]
      )
      return toNumber((result.rows[0] as { total_cases?: unknown } | undefined)?.total_cases)
    }

    const result = await pool.query(
      `SELECT COUNT(*)::bigint AS total_cases FROM ${this.schemaName}."cases"`
    )
    return toNumber((result.rows[0] as { total_cases?: unknown } | undefined)?.total_cases)
  }

  private async resolvePanelParams(params: CohortSearchParams): Promise<CohortSearchParams> {
    if (isNonEmptyArray(params.panel_intervals) || !isNonEmptyArray(params.active_panel_ids)) {
      return params
    }

    const panelIds = params.active_panel_ids.filter((id): id is number => typeof id === 'number')
    if (panelIds.length === 0) {
      return withoutActivePanelFields(params)
    }

    try {
      const intervals = await this.panelIntervalResolver(
        panelIds,
        params.genome_build ?? 'GRCh38',
        params.panel_padding_bp ?? 5000,
        await this.detectChrPrefix()
      )
      if (intervals.length === 0) {
        return withoutActivePanelFields(params)
      }

      return {
        ...withoutActivePanelFields(params),
        panel_intervals: intervals
      }
    } catch (error) {
      mainLogger.error(
        `Failed to resolve PostgreSQL cohort panel intervals for active gene panel(s): ${error instanceof Error ? error.message : String(error)}`,
        'cohort'
      )
      throw error
    }
  }

  private async resolvePanelIntervals(
    panelIds: number[],
    genomeBuild: string,
    paddingBp: number,
    chrPrefix: boolean
  ): Promise<GenomicInterval[]> {
    const panelResult = await this.pool.query<{ hgnc_id: string }>(
      `SELECT DISTINCT hgnc_id
       FROM ${this.schemaName}."panel_genes"
       WHERE panel_id = ANY($1::bigint[])`,
      [panelIds]
    )
    const hgncIds = panelResult.rows.map((row) => row.hgnc_id)
    if (hgncIds.length === 0) return []

    const coordinates = getGeneReferenceDb().getCoordinatesForGenes(hgncIds, genomeBuild)
    const intervals: GenomicInterval[] = []
    for (const coordinate of coordinates.values()) {
      const chr = chrPrefix
        ? coordinate.chromosome.startsWith('chr')
          ? coordinate.chromosome
          : `chr${coordinate.chromosome}`
        : coordinate.chromosome
      intervals.push({
        chr,
        start: Math.max(1, coordinate.start_pos - paddingBp),
        end: coordinate.end_pos + paddingBp
      })
    }

    return mergeOverlappingIntervals(intervals)
  }

  private async detectChrPrefix(): Promise<boolean> {
    const result = await this.pool.query<{ chr?: string }>(
      `SELECT chr FROM ${this.schemaName}."variants" LIMIT 1`
    )
    return result.rows[0]?.chr?.startsWith('chr') ?? false
  }

  private buildQueryParts(
    params: CohortSearchParams,
    totalCases: number | string
  ): {
    whereParts: string[]
    havingParts: string[]
    joins: string[]
    params: unknown[]
  } {
    const whereParts: string[] = []
    const havingParts: string[] = []
    const joins: string[] = []
    const values: unknown[] = []
    const addParam = (value: unknown): string => {
      values.push(value)
      return `$${values.length}`
    }

    if (params.search_term !== undefined && params.search_term.trim() !== '') {
      const term = params.search_term.trim()
      const genomicMatch = term.match(/^(?:chr)?(\d{1,2}|X|Y|MT?):(\d+)$/i)
      if (genomicMatch !== null) {
        whereParts.push(
          `(v.chr = ${addParam(genomicMatch[1])} AND v.pos = ${addParam(Number(genomicMatch[2]))})`
        )
      } else {
        const searchPattern = `%${term}%`
        whereParts.push(`(
          v.gene_symbol ILIKE ${addParam(searchPattern)}
          OR v.consequence ILIKE ${addParam(searchPattern)}
          OR v.omim_mim_number ILIKE ${addParam(searchPattern)}
        )`)
      }
    }

    if (isNonEmptyArray(params.panel_intervals)) {
      const intervalParts = params.panel_intervals.map(
        (interval) =>
          `(v.chr = ${addParam(interval.chr)} AND v.pos <= ${addParam(interval.end)} AND COALESCE(v.end_pos, v.pos) >= ${addParam(interval.start)})`
      )
      whereParts.push(`(${intervalParts.join(' OR ')})`)
    }

    if (params.gene_symbol !== undefined && params.gene_symbol !== '') {
      whereParts.push(`v.gene_symbol = ${addParam(params.gene_symbol)}`)
    }

    if (isNonEmptyArray(params.consequences)) {
      whereParts.push(
        `v.consequence IN (${params.consequences.map((value) => addParam(value)).join(', ')})`
      )
    }

    if (isNonEmptyArray(params.funcs)) {
      whereParts.push(`v.func IN (${params.funcs.map((value) => addParam(value)).join(', ')})`)
    }

    if (isNonEmptyArray(params.clinvars)) {
      whereParts.push(
        `v.clinvar IN (${params.clinvars.map((value) => addParam(value)).join(', ')})`
      )
    }

    if (params.gnomad_af_max !== undefined) {
      whereParts.push(`(v.gnomad_af IS NULL OR v.gnomad_af <= ${addParam(params.gnomad_af_max)})`)
    }

    if (params.cadd_min !== undefined) {
      whereParts.push(`(v.cadd IS NULL OR v.cadd >= ${addParam(params.cadd_min)})`)
    }

    if (params.genome_build !== undefined && params.genome_build !== '') {
      whereParts.push(`EXISTS (
        SELECT 1
        FROM ${this.schemaName}."cases" c_filter
        WHERE c_filter.id = v.case_id
          AND c_filter.genome_build = ${addParam(params.genome_build)}
      )`)
    }

    if (params.variant_type === 'snv') {
      whereParts.push("v.variant_type IN ('snv', 'indel')")
    } else if (params.variant_type !== undefined && params.variant_type !== '') {
      whereParts.push(`v.variant_type = ${addParam(params.variant_type)}`)
    }

    if (params.starred_only === true) {
      havingParts.push(
        this.buildAnnotationExists(
          "cva.starred::text IN ('1', 'true', 't')",
          "va.starred::text IN ('1', 'true', 't')"
        )
      )
    }

    if (params.has_comment === true) {
      havingParts.push(
        this.buildAnnotationExists(
          "NULLIF(cva.per_case_comment, '') IS NOT NULL",
          "NULLIF(va.global_comment, '') IS NOT NULL"
        )
      )
    }

    if (isNonEmptyArray(params.acmg_classifications)) {
      const acmgValues = params.acmg_classifications.map((value) => addParam(value)).join(', ')
      havingParts.push(
        this.buildAnnotationExists(
          `cva.acmg_classification IN (${acmgValues})`,
          `va.acmg_classification IN (${acmgValues})`
        )
      )
    }

    this.addColumnFilters(params, whereParts, havingParts, addParam, totalCases)

    if (params.max_internal_af !== undefined) {
      havingParts.push(
        `${this.cohortFrequencyExpression(totalCases)} <= ${addParam(params.max_internal_af)}`
      )
    }

    if (params.carrier_count_min !== undefined) {
      havingParts.push(`COUNT(DISTINCT v.case_id) >= ${addParam(params.carrier_count_min)}`)
    }

    return { whereParts, havingParts, joins, params: values }
  }

  private buildGroupedSelect(
    queryParts: { whereParts: string[]; havingParts: string[]; joins: string[] },
    totalCases: number | string,
    includeVariantKey: boolean
  ): string {
    const whereSql =
      queryParts.whereParts.length > 0
        ? `WHERE ${queryParts.whereParts.join('\n         AND ')}`
        : ''
    const havingSql =
      queryParts.havingParts.length > 0
        ? `HAVING ${queryParts.havingParts.join('\n          AND ')}`
        : ''
    const totalCasesSql = `${totalCases}`

    return `SELECT
        v.chr,
        v.pos,
        v.ref,
        v.alt,
        MAX(v.gene_symbol) AS gene_symbol,
        MAX(v.cdna) AS cdna,
        MAX(v.aa_change) AS aa_change,
        COUNT(DISTINCT v.case_id)::bigint AS carrier_count,
        ${totalCasesSql}::bigint AS total_cases,
        COUNT(DISTINCT v.case_id)::double precision / NULLIF(${totalCasesSql}, 0) AS cohort_frequency,
        ${HET_COUNT_SQL}::bigint AS het_count,
        ${HOM_COUNT_SQL}::bigint AS hom_count,
        ${includeVariantKey ? `v.chr || ':' || v.pos::text || ':' || v.ref || ':' || v.alt AS variant_key,` : ''}
        MAX(v.consequence) AS consequence,
        MAX(v.func) AS func,
        MAX(v.clinvar) AS clinvar,
        MIN(v.gnomad_af) AS gnomad_af,
        MAX(v.cadd) AS cadd_phred,
        MAX(v.transcript) AS transcript,
        MAX(v.omim_mim_number) AS omim_id
      FROM ${this.schemaName}."variants" v
      ${queryParts.joins.join('\n      ')}
      ${whereSql}
      GROUP BY v.chr, v.pos, v.ref, v.alt
      ${havingSql}`
  }

  private buildOrderBy(params: CohortSearchParams): string {
    const sortColumn =
      params.sort_by !== undefined && SORTABLE_COLUMNS[params.sort_by] !== undefined
        ? SORTABLE_COLUMNS[params.sort_by]
        : 'carrier_count'
    const sortOrder = params.sort_order === 'asc' ? 'ASC' : 'DESC'
    return `ORDER BY ${sortColumn} ${sortOrder} NULLS LAST, chr ASC, pos ASC, ref ASC, alt ASC`
  }

  private buildOptionalLimitOffset(
    params: CohortSearchParams,
    baseParams: unknown[]
  ): { sql: string; params: unknown[] } {
    const values = [...baseParams]
    const parts: string[] = []
    if (params.limit !== undefined) {
      values.push(params.limit)
      parts.push(`LIMIT $${values.length}`)
    }
    if (params.offset !== undefined) {
      values.push(params.offset)
      parts.push(`OFFSET $${values.length}`)
    }
    return { sql: parts.join('\n'), params: values }
  }

  private buildAnnotationExists(casePredicateSql: string, globalPredicateSql: string): string {
    return `(EXISTS (
      SELECT 1
      FROM ${this.schemaName}."case_variant_annotations" cva
      JOIN ${this.schemaName}."variants" annotated_v ON annotated_v.id = cva.variant_id
      WHERE annotated_v.chr = v.chr
        AND annotated_v.pos = v.pos
        AND annotated_v.ref = v.ref
        AND annotated_v.alt = v.alt
        AND ${casePredicateSql}
    ) OR EXISTS (
      SELECT 1
      FROM ${this.schemaName}."variant_annotations" va
      WHERE va.chr = v.chr
        AND va.pos = v.pos
        AND va.ref = v.ref
        AND va.alt = v.alt
        AND ${globalPredicateSql}
    ))`
  }

  private addColumnFilters(
    params: CohortSearchParams,
    whereParts: string[],
    havingParts: string[],
    addParam: (value: unknown) => string,
    totalCases: number | string
  ): void {
    if (params.column_filters === undefined) return

    const orderedColumns = [
      ...COHORT_COLUMN_FILTER_ORDER,
      ...Object.keys(params.column_filters)
        .filter((column) => !COHORT_COLUMN_FILTER_ORDER.includes(column))
        .sort()
    ]
    const extensionConditions = new Map<'sv.' | 'cnv.' | 'str.', string[]>()

    for (const column of orderedColumns) {
      const filter = params.column_filters[column]
      if (filter === undefined) continue
      const definition = COHORT_COLUMN_FILTER_DEFINITIONS[column]
      const expression =
        column === 'cohort_frequency' ? this.cohortFrequencyExpression(totalCases) : definition.sql
      const condition = this.buildColumnFilterCondition(expression, definition, filter, addParam)
      if (condition === '') continue
      if (definition.extensionPrefix !== undefined) {
        const conditions = extensionConditions.get(definition.extensionPrefix) ?? []
        conditions.push(condition)
        extensionConditions.set(definition.extensionPrefix, conditions)
        continue
      }
      if (definition.location === 'where') {
        whereParts.push(condition)
      } else {
        havingParts.push(condition)
      }
    }

    for (const [prefix, conditions] of extensionConditions) {
      havingParts.push(this.buildExtensionFilterExists(prefix, conditions))
    }
  }

  private assertSupportedColumnFilters(params: CohortSearchParams): void {
    if (params.column_filters === undefined) return

    const unsupportedColumns = Object.keys(params.column_filters).filter(
      (column) => COHORT_COLUMN_FILTER_DEFINITIONS[column] === undefined
    )
    if (unsupportedColumns.length > 0) {
      throw new Error(
        `Unsupported PostgreSQL cohort column filter(s): ${unsupportedColumns.join(', ')}`
      )
    }
  }

  private buildColumnFilterCondition(
    expression: string,
    definition: CohortColumnFilterDefinition,
    filter: ColumnFilter,
    addParam: (value: unknown) => string
  ): string {
    const { operator, value } = filter

    if (operator === 'in' && Array.isArray(value)) {
      if (value.length === 0) return ''
      return `${expression} IN (${value
        .map((item) => addParam(this.normalizeColumnFilterValue(item, definition)))
        .join(', ')})`
    }

    if (operator === 'like' && typeof value === 'string') {
      if (value.trim() === '') return ''
      const pattern = `%${value}%`
      if (definition.dataType === 'numeric') {
        return `${expression}::text ILIKE ${addParam(pattern)}`
      }
      return `${expression} ILIKE ${addParam(pattern)}`
    }

    if (
      (operator === '=' || operator === '!=') &&
      (typeof value === 'string' || typeof value === 'number')
    ) {
      return `${expression} ${operator} ${addParam(this.normalizeColumnFilterValue(value, definition))}`
    }

    if (
      (operator === '<' || operator === '>' || operator === '<=' || operator === '>=') &&
      (typeof value === 'string' || typeof value === 'number')
    ) {
      const comparison = `${expression} ${operator} ${addParam(this.normalizeColumnFilterValue(value, definition))}`
      const includeEmpty =
        filter.includeEmpty ??
        (definition.location === 'where' && definition.extensionPrefix === undefined)
      return includeEmpty ? `(${expression} IS NULL OR ${comparison})` : comparison
    }

    return ''
  }

  private cohortFrequencyExpression(totalCases: number | string): string {
    return `COUNT(DISTINCT v.case_id)::double precision / NULLIF(${totalCases}, 0)`
  }

  private buildExtensionFilterExists(
    prefix: 'sv.' | 'cnv.' | 'str.',
    conditions: string[]
  ): string {
    const table =
      prefix === 'sv.' ? 'variant_sv' : prefix === 'cnv.' ? 'variant_cnv' : 'variant_str'
    const alias = prefix === 'sv.' ? 'sv' : prefix === 'cnv.' ? 'cnv' : 'str_ext'
    return `EXISTS (
      SELECT 1
      FROM ${this.schemaName}."variants" ext_v
      JOIN ${this.schemaName}."${table}" ${alias} ON ${alias}.variant_id = ext_v.id
      WHERE ext_v.chr = v.chr
        AND ext_v.pos = v.pos
        AND ext_v.ref = v.ref
        AND ext_v.alt = v.alt
        AND ${conditions.join('\n        AND ')}
    )`
  }

  private normalizeColumnFilterValue(
    value: string | number,
    definition: CohortColumnFilterDefinition
  ): string | number {
    if (definition.dataType === 'text' || typeof value === 'number') return value
    const numericValue = Number(value)
    return Number.isFinite(numericValue) ? numericValue : value
  }

  private toCohortVariant(row: Record<string, unknown>, fallbackTotalCases: number): CohortVariant {
    const chr = String(row.chr ?? '')
    const pos = toNumber(row.pos)
    const ref = String(row.ref ?? '')
    const alt = String(row.alt ?? '')
    const totalCases = toNumber(row.total_cases) || fallbackTotalCases

    return {
      chr,
      pos,
      ref,
      alt,
      gene_symbol:
        row.gene_symbol === null || row.gene_symbol === undefined ? null : String(row.gene_symbol),
      cdna: row.cdna === null || row.cdna === undefined ? null : String(row.cdna),
      aa_change:
        row.aa_change === null || row.aa_change === undefined ? null : String(row.aa_change),
      carrier_count: toNumber(row.carrier_count),
      total_cases: totalCases,
      cohort_frequency: toNullableNumber(row.cohort_frequency) ?? 0,
      het_count: toNumber(row.het_count),
      hom_count: toNumber(row.hom_count),
      variant_key:
        row.variant_key === null || row.variant_key === undefined
          ? `${chr}:${pos}:${ref}:${alt}`
          : String(row.variant_key),
      consequence:
        row.consequence === null || row.consequence === undefined ? null : String(row.consequence),
      func: row.func === null || row.func === undefined ? null : String(row.func),
      clinvar: row.clinvar === null || row.clinvar === undefined ? null : String(row.clinvar),
      gnomad_af: toNullableNumber(row.gnomad_af),
      cadd_phred: toNullableNumber(row.cadd_phred),
      transcript:
        row.transcript === null || row.transcript === undefined ? null : String(row.transcript),
      omim_id: row.omim_id === null || row.omim_id === undefined ? null : String(row.omim_id)
    }
  }
}
