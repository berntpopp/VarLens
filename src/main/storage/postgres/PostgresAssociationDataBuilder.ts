/**
 * Postgres counterpart of the SQLite AssociationDataBuilder (desktop).
 *
 * Same filter semantics: the WHERE clause comes from the shared
 * `buildBaseWhere` (scope `cohort-burden`) and `buildExtensionJoinClauses`
 * helpers, rewritten from SQLite placeholders/collation to Postgres. Rows are
 * grouped into per-gene contingency data by the shared `contingency.ts`, so
 * desktop and web feed identical inputs to the statistical tests.
 */
import type { Pool } from 'pg'

import { buildBaseWhere, type BaseFilterInput } from '../../database/variant-where-builder'
import { buildExtensionJoinClauses } from '../../database/variant-extension-registry'
import {
  assertSingleGenomeBuild,
  buildCovariateMap,
  buildGeneContingencyData,
  type AssociationVariantRow,
  type CaseMetaRow,
  type CaseMetricRow
} from '../../statistics/contingency'
import type { AssociationBuildResult, VariantFilters } from '../../statistics/types'
import { gtDosageSql } from '../../../shared/sql/genotype-dosage'
import { autosomeSql } from '../../../shared/sql/chromosome-order'
import { quoteIdentifier } from './identifiers'

type Queryable = Pick<Pool, 'query'>

const EXTENSION_TABLES = ['variant_sv', 'variant_cnv', 'variant_str']

/**
 * Rewrite a SQLite fragment from the shared builders for Postgres:
 * `?` → `$n` (numbered from `firstIndex`), `LIKE ? COLLATE NOCASE` → `ILIKE`,
 * and unqualified extension tables → schema-qualified.
 */
export function toPostgresFragment(
  sql: string,
  firstIndex: number,
  schemaName: string
): { sql: string; next: number } {
  let index = firstIndex
  let out = sql.replace(/ LIKE \? COLLATE NOCASE/g, ' ILIKE ?')
  out = out.replace(/\?/g, () => `$${index++}`)
  for (const table of EXTENSION_TABLES) {
    out = out.replace(new RegExp(`JOIN ${table} `, 'g'), `JOIN ${schemaName}."${table}" `)
  }
  return { sql: out, next: index }
}

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

export class PostgresAssociationDataBuilder {
  private readonly schemaName: string

  constructor(
    private readonly pool: Queryable,
    schema: string
  ) {
    this.schemaName = quoteIdentifier(schema)
  }

  async build(
    groupA_ids: number[],
    groupB_ids: number[],
    filters: VariantFilters,
    covariateNames: string[]
  ): Promise<AssociationBuildResult> {
    const allIds = [...groupA_ids, ...groupB_ids]
    if (allIds.length === 0) return { genes: [], non_autosomal_variants: 0 }

    const builds = await this.pool.query<{ genome_build: string | null }>(
      `SELECT DISTINCT genome_build FROM ${this.schemaName}.cases WHERE id = ANY($1::bigint[])`,
      [allIds]
    )
    assertSingleGenomeBuild(builds.rows.map((r) => r.genome_build))

    const non_autosomal_variants = await this.countNonAutosomalVariants(allIds, filters)
    const rows = await this.loadVariantRows(allIds, filters)
    if (rows.length === 0) return { genes: [], non_autosomal_variants }

    const covariateMap =
      covariateNames.length > 0
        ? await this.loadCovariates(allIds, covariateNames)
        : new Map<number, number[]>()
    return {
      genes: buildGeneContingencyData(rows, groupA_ids, groupB_ids, covariateMap),
      non_autosomal_variants
    }
  }

  private buildSiteFilter(
    allIds: number[],
    filters: VariantFilters,
    autosomeCondition: string
  ): { joins: string; whereParts: string[]; params: unknown[] } {
    const baseInput: BaseFilterInput = {
      gnomad_af_max: filters.gnomad_af_max,
      cadd_min: filters.cadd_min,
      consequences: filters.consequences,
      clinvars: filters.clinvars,
      funcs: filters.funcs,
      gene_list: filters.gene_list,
      column_filters: filters.column_filters
    }
    const base = buildBaseWhere(baseInput, { baseAlias: 'v', scope: 'cohort-burden' })
    const ext = buildExtensionJoinClauses(filters.column_filters ?? {}, 'v')

    const params: unknown[] = [allIds]
    const whereParts = ['v.case_id = ANY($1::bigint[])', autosomeCondition]
    let next = 2
    if (base.sql !== '') {
      const converted = toPostgresFragment(base.sql, next, this.schemaName)
      whereParts.push(converted.sql)
      next = converted.next
      params.push(...base.params)
    }
    if (ext.whereClause !== '') {
      const converted = toPostgresFragment(ext.whereClause, next, this.schemaName)
      whereParts.push(converted.sql)
      params.push(...ext.params)
    }
    const joins = toPostgresFragment(ext.joins, next, this.schemaName).sql

    return { joins, whereParts, params }
  }

  private async countNonAutosomalVariants(
    allIds: number[],
    filters: VariantFilters
  ): Promise<number> {
    const { joins, whereParts, params } = this.buildSiteFilter(
      allIds,
      filters,
      `NOT (${autosomeSql('v.chr')})`
    )

    const result = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*) FROM (
         SELECT DISTINCT v.chr, v.pos, v.ref, v.alt
         FROM ${this.schemaName}."variants" v
         ${joins}
        WHERE ${whereParts.join(' AND ')}
      ) t`,
      params
    )
    return Number(result.rows[0].count)
  }

  private async loadVariantRows(
    allIds: number[],
    filters: VariantFilters
  ): Promise<AssociationVariantRow[]> {
    const { joins, whereParts, params } = this.buildSiteFilter(
      allIds,
      filters,
      autosomeSql('v.chr')
    )

    const result = await this.pool.query<Record<string, unknown>>(
      `WITH picked AS (SELECT unnest($1::bigint[]) AS id),
       selected AS (
         SELECT DISTINCT v.gene_symbol, v.chr, v.pos, v.ref, v.alt
         FROM ${this.schemaName}."variants" v
         ${joins}
         WHERE ${whereParts.join(' AND ')}
       )
       SELECT s.gene_symbol,
              r.case_id,
              r.chr || ':' || r.pos::text || ':' || r.ref || ':' || r.alt AS variant_key,
              r.gt_num,
              ${gtDosageSql('r.gt_num')} AS dosage,
              r.gnomad_af,
              r.cadd
         FROM selected s
         JOIN ${this.schemaName}."variants" r ON r.chr = s.chr AND r.pos = s.pos AND r.ref = s.ref AND r.alt = s.alt
        WHERE r.case_id IN (SELECT id FROM picked)
        ORDER BY s.gene_symbol COLLATE "C", r.chr COLLATE "C", r.pos, r.ref COLLATE "C", r.alt COLLATE "C", r.case_id`,
      params
    )

    return result.rows.map((row) => ({
      gene_symbol: String(row.gene_symbol),
      case_id: Number(row.case_id),
      variant_key: String(row.variant_key),
      gt_num: typeof row.gt_num === 'string' ? row.gt_num : null,
      // NULL dosage is carried as it is; contingency.ts decides what is missing (rowDosage).
      dosage: toNumberOrNull(row.dosage),
      gnomad_af: toNumberOrNull(row.gnomad_af),
      cadd: toNumberOrNull(row.cadd)
    }))
  }

  private async loadCovariates(
    caseIds: number[],
    covariateNames: string[]
  ): Promise<Map<number, number[]>> {
    const meta = await this.pool.query<Record<string, unknown>>(
      `SELECT case_id, sex, age FROM ${this.schemaName}."case_metadata"
        WHERE case_id = ANY($1::bigint[])`,
      [caseIds]
    )
    const metrics = await this.pool.query<Record<string, unknown>>(
      `SELECT cm.case_id, md.name, cm.numeric_value
         FROM ${this.schemaName}."case_metrics" cm
         JOIN ${this.schemaName}."metric_definitions" md ON cm.metric_id = md.id
        WHERE cm.case_id = ANY($1::bigint[]) AND md.name = ANY($2::text[])`,
      [caseIds, covariateNames]
    )
    const metaRows: CaseMetaRow[] = meta.rows.map((row) => ({
      case_id: Number(row.case_id),
      sex: typeof row.sex === 'string' ? row.sex : null,
      age: toNumberOrNull(row.age)
    }))
    const metricRows: CaseMetricRow[] = metrics.rows.map((row) => ({
      case_id: Number(row.case_id),
      name: String(row.name),
      numeric_value: toNumberOrNull(row.numeric_value)
    }))
    return buildCovariateMap(caseIds, covariateNames, metaRows, metricRows)
  }
}
