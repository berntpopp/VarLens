import { describe, expect, it } from 'vitest'
import { baseHeaders as caseHeaders } from '../../../../src/renderer/src/components/variant-table/columns'
import { baseHeaders as cohortHeaders } from '../../../../src/renderer/src/components/cohort/useCohortColumns'
import {
  COLUMN_WIDTHS,
  columnWidthPx,
  withFixedWidth
} from '../../../../src/renderer/src/components/variant-table/column-widths'

describe('shared fixed column widths (case/cohort parity)', () => {
  it('gives every main case and cohort column an explicit measured width', () => {
    for (const h of [...caseHeaders, ...cohortHeaders]) {
      expect(COLUMN_WIDTHS[h.key], `missing width for ${h.key}`).toBeGreaterThan(0)
    }
  })

  it('uses the same width for a column key in both views', () => {
    const shared = caseHeaders.filter((h) => cohortHeaders.some((c) => c.key === h.key))
    expect(shared.length).toBeGreaterThan(10)
    for (const h of shared) {
      const cohort = cohortHeaders.find((c) => c.key === h.key)!
      expect(withFixedWidth(h).width).toBe(withFixedWidth(cohort).width)
    }
  })

  it('falls back to link/default widths for dynamic columns', () => {
    expect(columnWidthPx('_link_varsome')).toBeGreaterThan(0)
    expect(withFixedWidth({ key: 'sv.support' }).width).toMatch(/^\d+px$/)
  })
})
