import type { Pool } from 'pg'

import type { ColumnFilterMeta } from '../../../shared/types/column-filters'
import type {
  CohortCarrier,
  CohortPaginatedResult,
  CohortSearchParams,
  CohortSummary,
  CohortVariant,
  GeneBurden,
  CohortVariantIdentity
} from '../../../shared/types/cohort'
import { cohortVariantKey } from '../../../shared/utils/cohort-variant-key'
import { cohortVariantTotalsSql, geneBurdenSql } from './cohort-gene-summary-sql'
import {
  prepareCohortRead,
  readCohortSummaryStatus,
  requireCurrentCohortSummary,
  type CohortReadWarnings
} from './cohort-read-freshness'
import { quoteIdentifier, toNumber } from './identifiers'
import { cohortAnnotationExportColumns, withAnnotationCells } from './postgres-annotation-export'
import { streamLongQuery } from './long-running-client'
import { POSTGRES_VARIANT_COLUMN_DEFINITIONS } from './postgres-variant-columns'
import { readCohortColumnMeta } from './postgres-cohort-column-meta'
import { querySummaryPage } from './postgres-cohort-summary-page'
import { carrierTotalsSql, summaryVersionSql } from './postgres-carrier-totals'
import {
  SUMMARY_FREQUENCY_SQL,
  buildSummaryExportSql,
  buildSummaryQueryParts,
  summaryBuildTotalsJoin
} from './postgres-cohort-summary-query'
import {
  PostgresPanelIntervalResolver,
  type PanelIntervalLookup
} from './postgres-panel-interval-resolver'
import { assertValidColumnFilterValues } from '../../../shared/filters/column-filter-validation'
import {
  normalizeCohortColumnFilters,
  COHORT_SUMMARY_FILTER_COLUMNS
} from '../../../shared/filters/cohort-column-filter-keys'
import { cohortCarriersSql } from '../../../shared/sql/cohort-call-sql'

type CohortPool = Pick<Pool, 'query' | 'connect'>

type Queryable = Pick<Pool, 'query'>

const NUMERIC_COLUMNS = new Set([
  'pos',
  'carrier_count',
  'cohort_frequency',
  'het_count',
  'hom_count',
  'gnomad_af',
  'cadd_phred',
  'end_pos',
  'sv_length'
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
  'transcript',
  'end_pos',
  'sv_type',
  'sv_length'
]

/**
 * Filter-UI key → expression over `cohort_variant_summary`. Every key is a
 * physical column on the summary table except `cohort_frequency`, which is
 * derived from carrier_count at read time; `cadd_phred` is the only rename
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
  cohort_frequency: SUMMARY_FREQUENCY_SQL,
  het_count: 'het_count',
  hom_count: 'hom_count',
  consequence: 'consequence',
  func: 'func',
  clinvar: 'clinvar',
  gnomad_af: 'gnomad_af',
  cadd_phred: 'cadd',
  transcript: 'transcript',
  end_pos: 'end_pos',
  sv_type: 'sv_type',
  sv_length: 'sv_length'
}

/** Column-filter keys the cohort view accepts: summary columns and extension columns. */
const SUPPORTED_COLUMN_FILTERS = new Set<string>([
  ...Object.keys(COHORT_SUMMARY_FILTER_COLUMNS),
  ...Object.keys(POSTGRES_VARIANT_COLUMN_DEFINITIONS).filter((key) => key.includes('.'))
])

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const numberValue = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numberValue) ? numberValue : null
}

const toNullableString = (value: unknown): string | null =>
  value === null || value === undefined ? null : String(value)

export class PostgresCohortRepository {
  private readonly schema: string
  private readonly schemaName: string
  private readonly panelIntervals: PostgresPanelIntervalResolver
  /** Column metadata of the summary as it was at `version` (see summaryVersion). */
  private columnMetaCache: { version: string; meta: ColumnFilterMeta[] } | null = null

  constructor(
    private readonly pool: CohortPool,
    schema: string,
    panelIntervalLookup?: PanelIntervalLookup
  ) {
    this.schema = schema
    this.schemaName = quoteIdentifier(schema)
    // Shared with the single-case read path so both views derive identical
    // panel regions (issue #447).
    this.panelIntervals = new PostgresPanelIntervalResolver(pool, schema, panelIntervalLookup)
  }

  private tbl(table: string): string {
    return `${this.schemaName}."${table}"`
  }

  /**
   * Changes whenever the summary or the set of visible cases does: every
   * import, deletion and rebuild stamps cohort_summary_state, and the case
   * count is the frequency denominator. Lets a long-lived process cache
   * derived metadata without serving it stale.
   */
  private async summaryVersion(): Promise<string> {
    const result = await this.pool.query<{ version: string }>(
      summaryVersionSql((table) => this.tbl(table))
    )
    return result.rows[0]?.version ?? ''
  }

  /** The summary table as `cvs`, with the per-build case totals the frequency needs. */
  private summaryWithBuildTotals(): string {
    return `${this.tbl('cohort_variant_summary')} cvs ${summaryBuildTotalsJoin((table) => this.tbl(table))}`
  }

  async queryVariants(params: CohortSearchParams): Promise<CohortPaginatedResult> {
    const resolvedParams = this.withSupportedColumnFilters(
      await this.panelIntervals.resolveCohortParams(params)
    )
    const totalCases = await this.getTotalCases(this.pool, resolvedParams)

    // Every cohort read is served from cohort_variant_summary, so the page, an
    // extension-filtered page and the export show the same representative
    // annotation (#469). Extension predicates are EXISTS probes on the carriers.
    const summaryResult = await this.querySummaryPage(resolvedParams, totalCases)
    if (summaryResult === null) {
      throw new Error('Cohort query cannot be served from the cohort summary')
    }
    return summaryResult
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

  /** C4 summary-page read (+ keyset paging). */
  private async querySummaryPage(
    params: CohortSearchParams,
    totalCases: number
  ): Promise<CohortPaginatedResult | null> {
    return querySummaryPage(
      {
        pool: this.pool as Pool,
        schema: this.schema,
        table: this.tbl('cohort_variant_summary'),
        tbl: (table) => this.tbl(table),
        carrierTotals: await carrierTotalsSql(this.pool, this.schema),
        toVariant: (row) => this.toCohortVariant(row, totalCases)
      },
      params,
      totalCases
    )
  }

  async getSummary(): Promise<CohortSummary> {
    // The variant figures come from maintained aggregates, so reconcile them
    // first, like any other read of the cohort summary.
    const { warnings } = await prepareCohortRead({ pool: this.pool, schema: this.schema })
    const totals = cohortVariantTotalsSql((table) => this.tbl(table))
    const result = await this.pool.query(
      `SELECT
         (SELECT COUNT(*)::bigint FROM ${this.schemaName}."cases") AS total_cases,
         (${totals.totalVariants}) AS total_variants,
         (${totals.uniqueVariants}) AS unique_variants,
         (${totals.genesWithVariants}) AS genes_with_variants,
         (
           SELECT COUNT(DISTINCT (va.chr, va.pos, va.ref, va.alt))::bigint
           FROM ${this.schemaName}."variant_annotations" va
           WHERE va.starred = 1
         ) AS starred_variants,
         (
           SELECT COUNT(DISTINCT (va.chr, va.pos, va.ref, va.alt))::bigint
           FROM ${this.schemaName}."variant_annotations" va
           WHERE va.acmg_classification = 'Pathogenic'
         ) AS pathogenic,
         (
           SELECT COUNT(DISTINCT (va.chr, va.pos, va.ref, va.alt))::bigint
           FROM ${this.schemaName}."variant_annotations" va
           WHERE va.acmg_classification = 'Likely pathogenic'
         ) AS likely_pathogenic,
         (
           SELECT COUNT(DISTINCT (va.chr, va.pos, va.ref, va.alt))::bigint
           FROM ${this.schemaName}."variant_annotations" va
           WHERE va.acmg_classification = 'Uncertain significance'
         ) AS vus,
         (
           SELECT COUNT(DISTINCT (va.chr, va.pos, va.ref, va.alt))::bigint
           FROM ${this.schemaName}."variant_annotations" va
           WHERE va.acmg_classification = 'Likely benign'
         ) AS likely_benign,
         (
           SELECT COUNT(DISTINCT (va.chr, va.pos, va.ref, va.alt))::bigint
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
      },
      // The maintained figures (unique variants, genes) lag while the summary
      // is being rebuilt: say so instead of presenting them as exact.
      ...(warnings !== undefined ? { warnings } : {})
    }
  }

  /** Carriers of one cohort row: one variant type in one genome build (#503). */
  async getCarriers(variant: CohortVariantIdentity): Promise<CohortCarrier[]> {
    const result = await this.pool.query(
      cohortCarriersSql('postgres', (table) => this.tbl(table)),
      [
        variant.chr,
        variant.pos,
        variant.ref,
        variant.alt,
        variant.variant_type,
        variant.genome_build
      ]
    )

    return (result.rows as Array<Record<string, unknown>>).map((row) => ({
      case_id: toNumber(row.case_id),
      case_name: String(row.case_name ?? ''),
      gt_num: String(row.gt_num ?? ''),
      qual: toNullableNumber(row.qual),
      gq: toNullableNumber(row.gq),
      dp: toNullableNumber(row.dp),
      filter: toNullableString(row.filter),
      caller: toNullableString(row.caller),
      end_pos: toNullableNumber(row.end_pos),
      sv_length: toNullableNumber(row.sv_length),
      sv_support: toNullableNumber(row.sv_support),
      sv_vaf: toNullableNumber(row.sv_vaf),
      copy_number: toNullableNumber(row.copy_number)
    }))
  }

  async getGeneBurden(): Promise<GeneBurden[]> {
    await prepareCohortRead({ pool: this.pool, schema: this.schema })
    const result = await this.pool.query(geneBurdenSql((table) => this.tbl(table)))

    return (result.rows as Array<Record<string, unknown>>).map((row) => ({
      gene_symbol: String(row.gene_symbol ?? ''),
      variant_count: toNumber(row.variant_count),
      unique_variant_count: toNumber(row.unique_variant_count),
      affected_case_count: toNumber(row.affected_case_count),
      total_cases: toNumber(row.total_cases)
    }))
  }

  /**
   * Cohort-view per-column metadata (C4 Step 2), read from the already-deduped
   * `cohort_variant_summary` table like SQLite cohort.ts:getColumnMeta; see
   * postgres-cohort-column-meta.ts for what is exact and what is capped.
   * Aggregating across `cohort_column_meta` would SUM per-case distinct counts
   * and overcount (Pass-3 HIGH #3), so the cohort path reads the summary table.
   */
  async getColumnMeta(): Promise<ColumnFilterMeta[]> {
    const version = await this.summaryVersion()
    if (this.columnMetaCache?.version === version) return this.columnMetaCache.meta

    const meta = await readCohortColumnMeta(this.pool as Pool, this.schema, {
      keys: COLUMN_META_KEYS,
      expressions: COLUMN_META_SUMMARY_COLUMNS,
      numericKeys: NUMERIC_COLUMNS,
      from: this.summaryWithBuildTotals()
    })
    this.columnMetaCache = { version, meta }
    return meta
  }

  /**
   * Rows for the cohort export: the same rows, annotation and order as the
   * cohort page (#469), read from the summary, streamed with a cursor. Never
   * from a stale summary: see requireCurrentCohortSummary.
   */
  async *streamCohortRows(
    params: CohortSearchParams,
    options: { refreshWaitMs?: number } = {}
  ): AsyncGenerator<Record<string, unknown>> {
    const resolvedParams = this.withSupportedColumnFilters(
      await this.panelIntervals.resolveCohortParams(params)
    )
    // A file cannot carry the page's "refreshing" hint: wait for a pending
    // rebuild, bounded, or fail with CohortSummaryRefreshingError.
    await requireCurrentCohortSummary(
      { pool: this.pool, schema: this.schema },
      options.refreshWaitMs
    )
    const totalCases = await this.getTotalCases(this.pool, resolvedParams)
    const { parts } = buildSummaryQueryParts(resolvedParams, totalCases, this.schema)
    const values = [...parts.values]
    const limitOffset: string[] = []
    if (resolvedParams.limit !== undefined) {
      values.push(resolvedParams.limit)
      limitOffset.push(`LIMIT $${values.length}`)
    }
    if (resolvedParams.offset !== undefined) {
      values.push(resolvedParams.offset)
      limitOffset.push(`OFFSET $${values.length}`)
    }
    const rows = streamLongQuery(
      this.pool,
      buildSummaryExportSql(
        this.tbl('cohort_variant_summary'),
        parts.whereParts,
        parts.orderBy,
        totalCases,
        summaryBuildTotalsJoin(
          (table) => this.tbl(table),
          await carrierTotalsSql(this.pool, this.schema)
        ),
        limitOffset.join('\n    '),
        cohortAnnotationExportColumns(this.schemaName)
      ),
      values
    )
    yield* withAnnotationCells(rows, 'cohort')
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

  /** Validated params with canonical column-filter keys (DSL `cadd` → `cadd_phred`, #528). */
  private withSupportedColumnFilters(params: CohortSearchParams): CohortSearchParams {
    if (params.column_filters === undefined) return params
    assertValidColumnFilterValues(params.column_filters)
    const columnFilters = normalizeCohortColumnFilters(params.column_filters) ?? {}

    const unsupportedColumns = Object.keys(columnFilters).filter(
      (column) => !SUPPORTED_COLUMN_FILTERS.has(column)
    )
    if (unsupportedColumns.length > 0) {
      throw new Error(
        `Unsupported PostgreSQL cohort column filter(s): ${unsupportedColumns.join(', ')}`
      )
    }
    return { ...params, column_filters: columnFilters }
  }

  private toCohortVariant(row: Record<string, unknown>, fallbackTotalCases: number): CohortVariant {
    const identity = {
      chr: String(row.chr ?? ''),
      pos: toNumber(row.pos),
      ref: String(row.ref ?? ''),
      alt: String(row.alt ?? ''),
      variant_type: String(row.variant_type ?? ''),
      genome_build: String(row.genome_build ?? '')
    }
    const totalCases = toNumber(row.total_cases) || fallbackTotalCases

    return {
      ...identity,
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
      // Built here, not read: the stored variant_key is the four-field form (#503).
      variant_key: cohortVariantKey(identity),
      consequence:
        row.consequence === null || row.consequence === undefined ? null : String(row.consequence),
      func: row.func === null || row.func === undefined ? null : String(row.func),
      clinvar: row.clinvar === null || row.clinvar === undefined ? null : String(row.clinvar),
      gnomad_af: toNullableNumber(row.gnomad_af),
      cadd_phred: toNullableNumber(row.cadd_phred),
      transcript:
        row.transcript === null || row.transcript === undefined ? null : String(row.transcript),
      omim_id: row.omim_id === null || row.omim_id === undefined ? null : String(row.omim_id),
      end_pos: toNullableNumber(row.end_pos),
      sv_type: toNullableString(row.sv_type),
      sv_length: toNullableNumber(row.sv_length)
    }
  }
}
