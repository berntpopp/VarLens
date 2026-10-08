import { describe, expect, it } from 'vitest'

import { AssociationConfigSchema } from '../../../src/shared/types/ipc-schemas'

describe('AssociationConfigSchema', () => {
  it('carries only filters the burden test applies (#510)', () => {
    const parsed = AssociationConfigSchema.parse({
      groupA_ids: [1],
      groupB_ids: [2],
      primary_test: 'fisher',
      weight_scheme: 'uniform',
      covariates: [],
      filters: {
        gnomad_af_max: 0.01,
        clinvars: ['Pathogenic'],
        acmg_classifications: ['Pathogenic'],
        max_internal_af: 0.1
      }
    })
    // The two cohort-summary filters were accepted and then dropped: they are stripped now.
    expect(parsed.filters).toEqual({ gnomad_af_max: 0.01, clinvars: ['Pathogenic'] })
  })
})
