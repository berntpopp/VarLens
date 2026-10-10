import { describe, expect, it } from 'vitest'

import type { CohortVariantIdentity } from '../../../src/shared/types/cohort'
import { cohortVariantKey } from '../../../src/shared/utils/cohort-variant-key'

const base: CohortVariantIdentity = {
  chr: '1',
  pos: 100,
  ref: 'A',
  alt: 'T',
  variant_type: 'snv',
  genome_build: 'GRCh38'
}

describe('cohortVariantKey', () => {
  it('is the same for the same six fields, whatever else the row carries', () => {
    expect(cohortVariantKey({ ...base })).toBe(cohortVariantKey(base))
    expect(cohortVariantKey({ ...base, carrier_count: 3 } as CohortVariantIdentity)).toBe(
      cohortVariantKey(base)
    )
  })

  it.each([
    ['chr', { chr: '2' }],
    ['pos', { pos: 101 }],
    ['ref', { ref: 'C' }],
    ['alt', { alt: 'G' }],
    ['variant_type', { variant_type: 'indel' }],
    ['genome_build', { genome_build: 'GRCh37' }]
  ] as Array<[string, Partial<CohortVariantIdentity>]>)('changes with %s', (_field, change) => {
    expect(cohortVariantKey({ ...base, ...change })).not.toBe(cohortVariantKey(base))
  })

  it('separates one <DEL> stored as sv and as cnv', () => {
    const del = { ...base, chr: '7', pos: 1000, ref: 'N', alt: '<DEL>' }
    expect(cohortVariantKey({ ...del, variant_type: 'sv' })).not.toBe(
      cohortVariantKey({ ...del, variant_type: 'cnv' })
    )
  })

  it('does not let a breakend ALT collide with another row', () => {
    // Joined with ':' both rows read 2:321681:G:]13:123456]T.
    const breakend = { ...base, chr: '2', pos: 321681, ref: 'G', alt: ']13:123456]T' }
    const shifted = { ...breakend, ref: 'G:]13', alt: '123456]T' }
    expect(cohortVariantKey(breakend)).not.toBe(cohortVariantKey(shifted))
  })
})
