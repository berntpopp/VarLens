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
 * Mirrors the FilterIpcParams contract for the subset of fields relevant
 * to burden analysis so that Path 3 reaches cohort parity with Paths 1
 * and 2. The extended fields flow through association:build DbPool
 * dispatch without touching AssociationEngine.run() or the statistical
 * WorkerRequest (which carries pre-built GeneContingencyData[], not filters).
 */
export interface VariantFilters {
  gnomad_af_max?: number
  cadd_min?: number
  consequences?: string[]
  gene_list?: string[]
  // Parity fields with Paths 1/2
  clinvars?: string[]
  funcs?: string[]
  acmg_classifications?: string[]
  max_internal_af?: number
  // Flexible column filter map — dotted keys (e.g. 'cnv.copy_number') route
  // through the shared extension helpers.
  column_filters?: ColumnFiltersParam
}

/** Per-gene data passed to worker threads */
export interface GeneContingencyData {
  gene_symbol: string
  groupA_carrier_count: number
  groupA_non_carrier_count: number
  groupB_carrier_count: number
  groupB_non_carrier_count: number
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
  n_variants: number
  groupA_carriers: number
  groupB_carriers: number
  groupA_total: number
  groupB_total: number
  fisher: FisherResult
  logistic_burden: LogisticBurdenResult
}

/** Final results with FDR correction applied */
export interface AssociationResults {
  results: GeneAssociationResultWithFDR[]
  primary_test: PrimaryTest
  config: AssociationConfig
  warnings: string[]
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
