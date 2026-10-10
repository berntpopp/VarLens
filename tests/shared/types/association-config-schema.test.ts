import { describe, expect, it } from 'vitest'

import { AssociationConfigSchema } from '../../../src/shared/types/ipc-schemas'

describe('AssociationConfigSchema', () => {
  it('rejects cohort-summary filters (#510)', () => {
    const result = AssociationConfigSchema.safeParse({
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
    expect(result.success).toBe(false)
  })
})
