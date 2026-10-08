import { describe, expect, it } from 'vitest'
import { AssociationConfigSchema } from '../../../src/shared/types/ipc-schemas'

describe('AssociationConfigSchema', () => {
  it('accepts valid configuration', () => {
    const config = {
      groupA_ids: [1, 2],
      groupB_ids: [3, 4],
      primary_test: 'fisher',
      weight_scheme: 'uniform',
      covariates: ['cov1'],
      filters: {
        clinvars: ['Pathogenic'],
        funcs: ['missense_variant']
      }
    }
    const result = AssociationConfigSchema.parse(config)
    expect(result).toEqual({ ...config, max_threads: 4 })
  })

  it('rejects acmg_classifications', () => {
    const config = {
      groupA_ids: [1, 2],
      groupB_ids: [3, 4],
      primary_test: 'fisher',
      weight_scheme: 'uniform',
      covariates: [],
      filters: {
        // @ts-expect-error simulating invalid input
        acmg_classifications: ['Pathogenic']
      }
    }
    expect(() => AssociationConfigSchema.parse(config)).toThrow()
  })

  it('rejects max_internal_af', () => {
    const config = {
      groupA_ids: [1, 2],
      groupB_ids: [3, 4],
      primary_test: 'fisher',
      weight_scheme: 'uniform',
      covariates: [],
      filters: {
        // @ts-expect-error simulating invalid input
        max_internal_af: 0.1
      }
    }
    expect(() => AssociationConfigSchema.parse(config)).toThrow()
  })
})
