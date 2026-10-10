import type { CohortVariant } from '../../../src/shared/types/cohort'
import { cohortVariantKey } from '../../../src/shared/utils/cohort-variant-key'

/**
 * The dev-mode mock aggregates the cohort itself; its het/hom counts must use
 * the shared genotype classes, like both real backends.
 */
import { describe, expect, it } from 'vitest'
import { mockVariants } from '../../../src/renderer/src/mocks/fixtures/variants'

describe('mock cohort het/hom counts', () => {
  it('use the shared genotype classes', async () => {
    const [first, second] = [...new Set(mockVariants.map((v) => v.case_id))]
    const at = { ...mockVariants[0], chr: 'chr9', pos: 424242 }
    mockVariants.push(
      { ...at, id: 990001, case_id: first, gt_num: '1|.' },
      { ...at, id: 990002, case_id: second, gt_num: '1' }
    )
    try {
      const { mockApi } = await import('../../../src/renderer/src/mocks/mockApi')
      const result = (await mockApi.cohort.getVariants({ limit: 1000 } as never)) as unknown as {
        data: Array<{ pos: number; carrier_count: number; het_count: number; hom_count: number }>
      }
      const row = result.data.find((v) => v.pos === 424242)
      // The split genotype is het; the haploid call is neither het nor hom.
      expect(row).toMatchObject({ carrier_count: 2, het_count: 1, hom_count: 0 })
    } finally {
      mockVariants.splice(-2)
    }
  })
})

describe('mock cohort row identity', () => {
  it('keys every row by the six fields and keeps the genome builds apart', async () => {
    const { mockApi } = await import('../../../src/renderer/src/mocks/mockApi')
    const { data } = (await mockApi.cohort.getVariants({ limit: 1000 } as never)) as unknown as {
      data: CohortVariant[]
    }
    expect(new Set(data.map((row) => row.genome_build))).toEqual(new Set(['GRCh37', 'GRCh38']))
    for (const row of data) expect(row.variant_key).toBe(cohortVariantKey(row))
    expect(new Set(data.map((row) => row.variant_key)).size).toBe(data.length)
  })

  it('lists as many carriers as each row counts', async () => {
    const { mockApi } = await import('../../../src/renderer/src/mocks/mockApi')
    const { data } = (await mockApi.cohort.getVariants({ limit: 1000 } as never)) as unknown as {
      data: CohortVariant[]
    }
    for (const row of data) {
      const carriers = (await mockApi.cohort.getCarriers(row)) as unknown as Array<{
        case_id: number
      }>
      // The mock counts a case once, also when it holds the variant twice.
      expect(carriers).toHaveLength(row.carrier_count)
    }
  })
})
