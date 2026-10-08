/**
 * Types for gene burden association analysis.
 */

import type { ColumnFiltersParam } from '../../shared/types/column-filters'

/** Weighting scheme for burden collapse */
export type WeightScheme = 'uniform' | 'beta_maf' | 'beta_maf_cadd'

/** Which test is primary (gets FDR correction) */
export type PrimaryTest = 'fisher' | 'logistic_burden'

/** Configuration for running association analysis */
export interface AssociationConfig {
  groupA_ids: number[]
  groupB_ids: number[]
  primary_test: PrimaryTest
  weight_scheme: WeightScheme
  covariates: string[]
  filters: VariantFilters
  max_threads: number
}

/**
 * Variant-level filters applied before association.
 *
 * Variant-level filters that select the sites of an association run. Every
 * field is applied to `variants` rows by both AssociationDataBuilders; a
 * filter that needs the cohort summary (ACMG class, cohort frequency) is not
 * part of this contract.
 */
export interface VariantFilters {
  gnomad_af_max?: number
  cadd_min?: number
  consequences?: string[]
  gene_list?: string[]
  clinvars?: string[]
  funcs?: string[]
  // Flexible column filter map — dotted keys (e.g. 'cnv.copy_number') route
  // through the shared extension helpers.
  column_filters?: ColumnFiltersParam
}

/** Why a selected site is left out of a gene's burden score and Fisher table. */
export type SiteExclusionReason = 'missing_call' | 'conflicting_calls' | 'no_called_alleles'

/** Excluded sites of one gene, per reason. Every key is always present. */
export type SiteExclusionCounts = Record<SiteExclusionReason, number>

/** Per-gene data passed to worker threads */
export interface GeneContingencyData {
  gene_symbol: string
  groupA_carrier_count: number
  groupA_non_carrier_count: number
  groupB_carrier_count: number
  groupB_non_carrier_count: number
  sites_excluded: SiteExclusionCounts
  samples: SampleBurdenData[]
}

/** Per-sample data for logistic regression */
export interface SampleBurdenData {
  group: 0 | 1
  dosages: number[]
  variant_mafs: number[]
  variant_cadds: (number | null)[]
  covariate_values: number[]
}

/** Fisher's exact test result */
export interface FisherResult {
  p_value: number | null
  odds_ratio: number | null
  ci_lower: number | null
  ci_upper: number | null
}

/** Logistic burden test result */
export interface LogisticBurdenResult {
  p_value: number | null
  beta: number | null
  se: number | null
  ci_lower: number | null
  ci_upper: number | null
  used_firth: boolean
  warning?: string
  /** Samples excluded from the regression because a selected covariate was missing. */
  n_missing_covariate?: number
}

/** Combined result for one gene */
export interface GeneAssociationResult {
  gene_symbol: string
  /** Sites used: eligible sites with a known call in every selected sample. */
  n_variants: number
  sites_excluded: SiteExclusionCounts
  groupA_carriers: number
  groupB_carriers: number
  groupA_total: number
  groupB_total: number
  fisher: FisherResult
  logistic_burden: LogisticBurdenResult
}

/** What an AssociationDataBuilder returns for one run. */
export interface AssociationBuildResult {
  genes: GeneContingencyData[]
  /** Qualifying variants left out because they are not on an autosome (1..22). */
  non_autosomal_variants: number
}

/** Final results with FDR correction applied */
export interface AssociationResults {
  results: GeneAssociationResultWithFDR[]
  primary_test: PrimaryTest
  config: AssociationConfig
  warnings: string[]
  /** Qualifying variants left out because they are not on an autosome (1..22). */
  non_autosomal_variants: number
  elapsed_ms: number
}

/** Gene result with FDR q-value on primary test */
export interface GeneAssociationResultWithFDR extends GeneAssociationResult {
  q_value: number | null
}

/** Worker thread message types */
export interface WorkerRequest {
  type: 'run'
  genes: GeneContingencyData[]
  weight_scheme: WeightScheme
}

export interface WorkerResponse {
  type: 'result' | 'progress' | 'error'
  gene_symbol?: string
  result?: GeneAssociationResult
  progress?: { completed: number; total: number }
  error?: string
}
