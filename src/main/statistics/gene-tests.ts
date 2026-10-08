import { logisticBurdenTest } from './burden'
import { fisherExactTest } from './fisher'
import type {
  FisherResult,
  GeneAssociationResult,
  GeneContingencyData,
  WeightScheme
} from './types'

const NOT_TESTED: FisherResult = {
  p_value: null,
  odds_ratio: null,
  ci_lower: null,
  ci_upper: null
}

/**
 * Fisher's exact test + logistic burden test for one gene. Pure; runs in the
 * desktop statistics worker threads and in-process on the web server.
 */
export function computeGeneAssociation(
  gene: GeneContingencyData,
  weightScheme: WeightScheme
): GeneAssociationResult {
  const sitesUsed = gene.samples.length > 0 ? gene.samples[0].dosages.length : 0
  // No usable site is not a test: a Fisher p of 1 would count in the FDR correction.
  const fisher =
    sitesUsed === 0
      ? NOT_TESTED
      : fisherExactTest(
          gene.groupA_carrier_count,
          gene.groupB_carrier_count,
          gene.groupA_non_carrier_count,
          gene.groupB_non_carrier_count
        )
  const logistic = logisticBurdenTest(gene.samples, weightScheme)
  return {
    gene_symbol: gene.gene_symbol,
    n_variants: sitesUsed,
    sites_excluded: gene.sites_excluded,
    groupA_carriers: gene.groupA_carrier_count,
    groupB_carriers: gene.groupB_carrier_count,
    groupA_total: gene.groupA_carrier_count + gene.groupA_non_carrier_count,
    groupB_total: gene.groupB_carrier_count + gene.groupB_non_carrier_count,
    fisher,
    logistic_burden: logistic
  }
}
