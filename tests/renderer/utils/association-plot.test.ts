import { describe, it, expect } from 'vitest'
import {
  buildManhattanPoints,
  buildVolcanoPoints,
  negLog10P,
  pValueLabel,
  type AssociationPlotRow
} from '../../../src/renderer/src/utils/association-plot'

function row(
  gene: string,
  p: number | null,
  oddsRatio: number | null,
  infinite = false,
  q: number | null = null
): AssociationPlotRow {
  return {
    gene_symbol: gene,
    fisher: { p_value: p, odds_ratio: oddsRatio, odds_ratio_infinite: infinite },
    logistic_burden: { p_value: p, beta: oddsRatio === null ? null : Math.log(oddsRatio) },
    q_value: q
  }
}

describe('negLog10P / pValueLabel', () => {
  it('puts p = 0 at the top, not at 0', () => {
    expect(negLog10P(0)).toBeGreaterThan(300)
    expect(pValueLabel(0)).toBe('p < 1e-300')
  })
  it('keeps tiny p-values exact', () => {
    expect(negLog10P(1e-200)).toBeCloseTo(200, 10)
    expect(pValueLabel(1e-200)).toBe('p = 1.00e-200')
    expect(pValueLabel(1e-310)).toBe('p < 1e-300')
  })
  it('maps p = 1 to 0', () => {
    expect(negLog10P(1)).toBe(0)
    expect(pValueLabel(1)).toBe('p = 1.00')
  })
})

describe('buildVolcanoPoints', () => {
  // JSON turns Infinity into null; the flag carries it.
  const results = JSON.parse(
    JSON.stringify([
      row('ZERO_P', 0, 4, false, 0.001),
      row('TINY', 1e-200, 8),
      row('NULL_P', null, 2),
      row('ONE', 1, 1),
      row('ONE_SIDED', 1e-20, Infinity, true, 0.001),
      row('NO_CARRIER_A', 1e-5, 0)
    ])
  ) as AssociationPlotRow[]
  const points = buildVolcanoPoints(results, 'fisher', 0.05)
  const byGene = new Map(points.map((p) => [p.gene, p]))

  it('skips genes without a p-value only', () => {
    expect(points.map((p) => p.gene)).toEqual([
      'ZERO_P',
      'TINY',
      'ONE',
      'ONE_SIDED',
      'NO_CARRIER_A'
    ])
  })

  it('plots p = 0 above every finite p', () => {
    expect(byGene.get('ZERO_P')!.y).toBeGreaterThan(byGene.get('TINY')!.y)
    expect(byGene.get('ONE')!.y).toBe(0)
  })

  it('plots an infinite odds ratio at a capped x beyond every finite effect', () => {
    const oneSided = byGene.get('ONE_SIDED')!
    expect(oneSided.capped).toBe(true)
    expect(oneSided.x).toBe(4) // max |log2 OR| = 3, cap = 3 + 1
    expect(oneSided.significant).toBe(true)
    const zeroOr = byGene.get('NO_CARRIER_A')!
    expect(zeroOr.capped).toBe(true)
    expect(zeroOr.x).toBe(-4)
    expect(byGene.get('TINY')!.capped).toBe(false)
  })

  it('uses beta directly for the burden test', () => {
    const burden = buildVolcanoPoints([row('B', 0.01, Math.E)], 'logistic_burden', 0.05)
    expect(burden[0].x).toBeCloseTo(1, 12)
  })
})

describe('buildManhattanPoints', () => {
  it('keeps p = 0 and tiny p-values visible and drops null', () => {
    const points = buildManhattanPoints(
      [row('A', 0, 1, false, 0.01), row('B', null, 1), row('C', 1e-100, 1)],
      'fisher'
    )
    expect(points.map((p) => [p.gene, p.x])).toEqual([
      ['A', 0],
      ['C', 1]
    ])
    expect(points[0].y).toBeGreaterThan(300)
    expect(points[0].pLabel).toBe('p < 1e-300')
    expect(points[0].significant).toBe(true)
    expect(points[1].y).toBeCloseTo(100, 10)
  })
})
