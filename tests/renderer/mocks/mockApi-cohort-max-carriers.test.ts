/**
 * The dev-mode mock aggregates the cohort itself; it honours the carrier cap
 * (#455) like both real backends.
 */
import { describe, expect, it } from 'vitest'
import { mockVariants } from '../../../src/renderer/src/mocks/fixtures/variants'

describe('mock cohort carrier cap', () => {
  it('keeps the variants seen in at most N cases; a cap below 1 is off', async () => {
    const [first, second] = [...new Set(mockVariants.map((v) => v.case_id))]
    const shared = { ...mockVariants[0], chr: 'chr9', pos: 434343 }
    const single = { ...mockVariants[0], chr: 'chr9', pos: 434344 }
    mockVariants.push(
      { ...shared, id: 990011, case_id: first },
      { ...shared, id: 990012, case_id: second },
      { ...single, id: 990013, case_id: first }
    )
    try {
      const { mockApi } = await import('../../../src/renderer/src/mocks/mockApi')
      const positions = async (max?: number): Promise<number[]> => {
        const result = (await mockApi.cohort.getVariants({
          limit: 10000,
          carrier_count_max: max
        } as never)) as unknown as { data: Array<{ pos: number; carrier_count: number }> }
        if (max !== undefined && max >= 1) {
          expect(result.data.every((v) => v.carrier_count <= max)).toBe(true)
        }
        return result.data.map((v) => v.pos)
      }

      const capped = await positions(1)
      expect(capped).toContain(434344)
      expect(capped).not.toContain(434343)
      expect(await positions(2)).toContain(434343)
      expect(await positions(0)).toContain(434343)
      expect(await positions()).toContain(434343)
    } finally {
      mockVariants.splice(-3)
    }
  })
})
