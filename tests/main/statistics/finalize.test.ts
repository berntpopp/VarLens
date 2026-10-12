import { describe, it, expect } from 'vitest'
import { finalizeAssociationResults } from '../../../src/main/statistics/finalize'
import {
  ASSOCIATION_WARNING_TEXT,
  untestedGeneReason
} from '../../../src/shared/config/domain.config'
import type { AssociationConfig, GeneAssociationResult } from '../../../src/main/statistics/types'

const config: AssociationConfig = {
  groupA_ids: [],
  groupB_ids: [],
  primary_test: 'logistic_burden',
  weight_scheme: 'uniform',
  covariates: [],
  filters: {},
  max_threads: 1
}

function geneWithWarning(warning: string): GeneAssociationResult {
  return {
    gene_symbol: 'GENE1',
    n_variants: 1,
    sites_excluded: { missing_call: 0, conflicting_calls: 0, no_called_alleles: 0 },
    groupA_carriers: 0,
    groupB_carriers: 0,
    groupA_total: 1,
    groupB_total: 1,
    fisher: { p_value: null, odds_ratio: null, ci_lower: null, ci_upper: null },
    logistic_burden: {
      p_value: null,
      beta: null,
      se: null,
      ci_lower: null,
      ci_upper: null,
      used_firth: true,
      warning
    }
  }
}

describe('finalizeAssociationResults warnings', () => {
  it.each(Object.entries(ASSOCIATION_WARNING_TEXT))('reports %s as a sentence', (code, text) => {
    const { warnings } = finalizeAssociationResults([geneWithWarning(code)], config, Date.now())
    expect(warnings).toEqual([`GENE1: ${text}`])
  })

  it('passes an unknown code through unchanged', () => {
    const { warnings } = finalizeAssociationResults([geneWithWarning('NEW_CODE')], config, 0)
    expect(warnings).toEqual(['GENE1: NEW_CODE'])
  })

  it('names an untested gene with its reason instead of a logistic code', () => {
    const untested = {
      ...geneWithWarning('ZERO_BURDEN'),
      n_variants: 0,
      sites_excluded: { missing_call: 1, conflicting_calls: 0, no_called_alleles: 0 }
    }
    const { warnings } = finalizeAssociationResults([untested], config, 0)
    expect(warnings).toEqual([`GENE1: ${untestedGeneReason(untested.sites_excluded)}`])
  })
})
