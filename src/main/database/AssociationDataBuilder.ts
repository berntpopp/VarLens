import type Database from 'better-sqlite3-multiple-ciphers'
import type { AssociationBuildResult, VariantFilters } from '../statistics/types'
import {
  assertSingleGenomeBuild,
  buildCovariateMap,
  buildGeneContingencyData,
  type AssociationVariantRow,
  type CaseMetaRow,
  type CaseMetricRow
} from '../statistics/contingency'
import { autosomeSql } from '../../shared/sql/chromosome-order'
import { gtDosageSql } from '../../shared/sql/genotype-dosage'
import { sqlPlaceholders } from './sql-utils'
import { buildBaseWhere, type BaseFilterInput } from './variant-where-builder'
import { buildExtensionJoinClauses } from './variant-extension-registry'

/** The filters of a run as SQL on `variants v`, without the case and chromosome terms. */
interface SiteFilter {
  joins: string
  conditions: string[]
  params: (string | number)[]
}

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
  ): AssociationBuildResult {
    const allIds = [...groupA_ids, ...groupB_ids]
    if (allIds.length === 0) return { genes: [], non_autosomal_variants: 0 }

    const placeholders = sqlPlaceholders(allIds.length)
    assertSingleGenomeBuild(
      this.db
        .prepare(`SELECT DISTINCT genome_build FROM cases WHERE id IN (${placeholders})`)
        .pluck()
        .all(...allIds) as (string | null)[]
    )

    const site = this.siteFilter(filters)
    const non_autosomal_variants = this.countNonAutosomalVariants(allIds, placeholders, site)
    const variantRows = this.loadVariantRows(allIds, placeholders, site)
    if (variantRows.length === 0) return { genes: [], non_autosomal_variants }

    const covariateMap =
      covariateNames.length > 0
        ? this.loadCovariates(allIds, covariateNames)
        : new Map<number, number[]>()
    return {
      genes: buildGeneContingencyData(variantRows, groupA_ids, groupB_ids, covariateMap),
      non_autosomal_variants
    }
  }

  private siteFilter(filters: VariantFilters): SiteFilter {
    // scope='cohort-burden' emits the gene_symbol IS NOT NULL + != '' invariants.
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
    // Extension (dotted) column_filters — direct JOIN mode (same as VariantFilterBuilder).
    const ext = buildExtensionJoinClauses(filters.column_filters ?? {}, 'v')
    return {
      joins: ext.joins,
      conditions: [base.sql, ext.whereClause].filter((sql) => sql !== ''),
      params: [...base.params, ...ext.params]
    }
  }

  /** Qualifying variants of the selected cases that are not on an autosome: reported, never tested. */
  private countNonAutosomalVariants(
    allIds: number[],
    placeholders: string,
    site: SiteFilter
  ): number {
    const where = [
      `v.case_id IN (${placeholders})`,
      `NOT (${autosomeSql('v.chr')})`,
      ...site.conditions
    ]
    return this.db
      .prepare(
        `
      SELECT COUNT(*) FROM (
        SELECT DISTINCT v.chr, v.pos, v.ref, v.alt
        FROM variants v
        ${site.joins}
        WHERE ${where.join(' AND ')}
      )
    `
      )
      .pluck()
      .get(...allIds, ...site.params) as number
  }

  /**
   * Select, then collect. `selected` holds the autosomal sites that pass every
   * filter in at least one selected case. The outer query then reads every
   * stored row of the selected cases at those sites without a row filter, so a
   * filter cannot turn a carrier into a reference sample. The case ids are
   * bound once (`picked`), which keeps the SQLite parameter count at one per case.
   */
  private loadVariantRows(
    allIds: number[],
    placeholders: string,
    site: SiteFilter
  ): AssociationVariantRow[] {
    const where = ['v.case_id IN (SELECT id FROM picked)', autosomeSql('v.chr'), ...site.conditions]
    return this.db
      .prepare(
        `
      WITH picked(id) AS (SELECT id FROM cases WHERE id IN (${placeholders})),
      selected AS (
        SELECT DISTINCT v.gene_symbol, v.chr, v.pos, v.ref, v.alt
        FROM variants v
        ${site.joins}
        WHERE ${where.join(' AND ')}
      )
      SELECT s.gene_symbol,
             r.case_id,
             r.chr || ':' || r.pos || ':' || r.ref || ':' || r.alt AS variant_key,
             r.gt_num,
             ${gtDosageSql('r.gt_num')} AS dosage,
             r.gnomad_af,
             r.cadd
      FROM selected s
      JOIN variants r ON r.chr = s.chr AND r.pos = s.pos AND r.ref = s.ref AND r.alt = s.alt
      WHERE r.case_id IN (SELECT id FROM picked)
      ORDER BY s.gene_symbol, r.chr, r.pos, r.ref, r.alt, r.case_id
    `
      )
      .all(...allIds, ...site.params) as AssociationVariantRow[]
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
