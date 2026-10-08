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
