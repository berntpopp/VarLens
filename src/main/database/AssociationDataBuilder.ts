import type Database from 'better-sqlite3-multiple-ciphers'
import type { GeneContingencyData, VariantFilters } from '../statistics/types'
import {
  buildCovariateMap,
  buildGeneContingencyData,
  type AssociationVariantRow,
  type CaseMetaRow,
  type CaseMetricRow
} from '../statistics/contingency'
import { GT_DOSAGE_SQL } from '../../shared/sql/genotype-dosage'
import { sqlPlaceholders } from './sql-utils'
import { buildBaseWhere, type BaseFilterInput } from './variant-where-builder'
import { buildExtensionJoinClauses } from './variant-extension-registry'

export class AssociationDataBuilder {
  private db: Database.Database

  constructor(db: Database.Database) {
    this.db = db
  }

  build(
    groupA_ids: number[],
    groupB_ids: number[],
    filters: VariantFilters,
    covariateNames: string[]
  ): GeneContingencyData[] {
    const allIds = [...groupA_ids, ...groupB_ids]
    if (allIds.length === 0) return []

    const baseAlias = 'v'

    // Delegate base-field + bare-key column_filters to the shared helper.
    // scope='cohort-burden' emits the gene_symbol IS NOT NULL + != ''
    // invariants so we don't have to hand-roll them.
    const baseInput: BaseFilterInput = {
      gnomad_af_max: filters.gnomad_af_max,
      cadd_min: filters.cadd_min,
      consequences: filters.consequences,
      clinvars: filters.clinvars,
      funcs: filters.funcs,
      gene_list: filters.gene_list,
      acmg_classifications: filters.acmg_classifications,
      max_internal_af: filters.max_internal_af,
      column_filters: filters.column_filters
    }
    const { sql: baseWhere, params: baseParams } = buildBaseWhere(baseInput, {
      baseAlias,
      scope: 'cohort-burden'
    })

    // Extension (dotted) column_filters — direct JOIN mode (same as VariantFilterBuilder).
    const {
      joins: extJoins,
      whereClause: extWhere,
      params: extParams
    } = buildExtensionJoinClauses(filters.column_filters ?? {}, baseAlias)

    // Case ID filter stays hand-rolled — not a BaseFilterInput field.
    const placeholders = sqlPlaceholders(allIds.length)
    const whereParts: string[] = [`${baseAlias}.case_id IN (${placeholders})`]
    if (baseWhere !== '') whereParts.push(baseWhere)
    if (extWhere !== '') whereParts.push(extWhere)
    const whereClause = whereParts.join(' AND ')

    // Step 1: Get all qualifying variants grouped by gene and case
    const variantRows = this.db
      .prepare(
        `
      SELECT ${baseAlias}.gene_symbol,
             ${baseAlias}.case_id,
             ${baseAlias}.chr || ':' || ${baseAlias}.pos || ':' || ${baseAlias}.ref || ':' || ${baseAlias}.alt AS variant_key,
             ${GT_DOSAGE_SQL} AS dosage,
             ${baseAlias}.gnomad_af,
             ${baseAlias}.cadd
      FROM variants ${baseAlias}
      ${extJoins}
      WHERE ${whereClause}
      ORDER BY ${baseAlias}.gene_symbol, variant_key, ${baseAlias}.case_id
    `
      )
      .all(...allIds, ...baseParams, ...extParams) as AssociationVariantRow[]

    if (variantRows.length === 0) return []

    const covariateMap =
      covariateNames.length > 0
        ? this.loadCovariates(allIds, covariateNames)
        : new Map<number, number[]>()
    return buildGeneContingencyData(variantRows, groupA_ids, groupB_ids, covariateMap)
  }

  private loadCovariates(caseIds: number[], covariateNames: string[]): Map<number, number[]> {
    const placeholders = sqlPlaceholders(caseIds.length)
    const metaRows = this.db
      .prepare(`SELECT case_id, sex, age FROM case_metadata WHERE case_id IN (${placeholders})`)
      .all(...caseIds) as CaseMetaRow[]

    const metricRows = this.db
      .prepare(
        `
      SELECT cm.case_id, md.name, cm.numeric_value
      FROM case_metrics cm
      JOIN metric_definitions md ON cm.metric_id = md.id
      WHERE cm.case_id IN (${placeholders})
        AND md.name IN (${sqlPlaceholders(covariateNames.length)})
    `
      )
      .all(...caseIds, ...covariateNames) as CaseMetricRow[]

    return buildCovariateMap(caseIds, covariateNames, metaRows, metricRows)
  }
}
