import { benjaminiHochberg } from './fdr'
import type {
  AssociationConfig,
  AssociationResults,
  GeneAssociationResult,
  GeneAssociationResultWithFDR
} from './types'

function primaryP(config: AssociationConfig, r: GeneAssociationResult): number | null {
  return config.primary_test === 'fisher' ? r.fisher.p_value : r.logistic_burden.p_value
}

/** Empty result set with one warning (no qualifying genes, or cancelled). */
export function emptyAssociationResults(
  config: AssociationConfig,
  warning: string,
  startedAt: number
): AssociationResults {
  return {
    results: [],
    primary_test: config.primary_test,
    config,
    warnings: [warning],
    elapsed_ms: Date.now() - startedAt
  }
}

/**
 * Shared tail of an association run (desktop engine and web runner):
 * collect logistic warnings, apply Benjamini–Hochberg FDR on the primary
 * test, and sort by primary p-value (nulls last).
 */
export function finalizeAssociationResults(
  rawResults: GeneAssociationResult[],
  config: AssociationConfig,
  startedAt: number
): AssociationResults {
  const warnings: string[] = []
  for (const result of rawResults) {
    if (result.logistic_burden.warning !== undefined && result.logistic_burden.warning !== '') {
      warnings.push(`${result.gene_symbol}: ${result.logistic_burden.warning}`)
    }
  }

  const qValues = benjaminiHochberg(rawResults.map((r) => primaryP(config, r)))
  const results: GeneAssociationResultWithFDR[] = rawResults.map((r, i) => ({
    ...r,
    q_value: qValues[i]
  }))

  results.sort((a, b) => {
    const pa = primaryP(config, a)
    const pb = primaryP(config, b)
    if (pa === null) return 1
    if (pb === null) return -1
    return pa - pb
  })

  return {
    results,
    primary_test: config.primary_test,
    config,
    warnings,
    elapsed_ms: Date.now() - startedAt
  }
}
