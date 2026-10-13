/**
 * Pure point builders for the association Volcano and Manhattan plots.
 * Extreme p-values and one-sided genes must stay visible, not drop to the axis or vanish.
 */

export interface AssociationPlotRow {
  gene_symbol: string
  fisher: { p_value: number | null; odds_ratio: number | null; odds_ratio_infinite?: boolean }
  logistic_burden: { p_value: number | null; beta: number | null }
  q_value: number | null
}

export interface PlotPoint {
  gene: string
  x: number
  y: number
  /** Hover text for the p-value, e.g. "p = 1.23e-8" or "p < 1e-300". */
  pLabel: string
  /** Effect beyond the axis (infinite or zero odds ratio), drawn at the capped x. */
  capped: boolean
  significant: boolean
}

/** -log10(p); p = 0 (underflow) plots at the top instead of at 0. */
export function negLog10P(p: number): number {
  return 0 - Math.log10(Math.max(p, Number.MIN_VALUE)) // 0 - x, so p = 1 gives 0, not -0
}

export function pValueLabel(p: number): string {
  return p < 1e-300 ? 'p < 1e-300' : `p = ${p.toPrecision(3)}`
}

function primaryP(r: AssociationPlotRow, primaryTest: string): number | null {
  return primaryTest === 'fisher' ? r.fisher.p_value : r.logistic_burden.p_value
}

/** x = log2(OR) for Fisher or beta for the burden test; null when there is no effect. */
function effectX(r: AssociationPlotRow, primaryTest: string): number | null {
  if (primaryTest !== 'fisher') return r.logistic_burden.beta
  if (r.fisher.odds_ratio_infinite === true) return Infinity
  const or = r.fisher.odds_ratio
  if (or === null) return null
  return Math.log2(or) // OR 0 -> -Infinity, capped below
}

export function buildVolcanoPoints(
  results: AssociationPlotRow[],
  primaryTest: string,
  fdrThreshold: number
): PlotPoint[] {
  const raw: Array<{ r: AssociationPlotRow; p: number; x: number }> = []
  for (const r of results) {
    const p = primaryP(r, primaryTest)
    const x = effectX(r, primaryTest)
    if (p === null || x === null || Number.isNaN(x)) continue
    raw.push({ r, p, x })
  }
  const maxFinite = raw.reduce((m, d) => (Number.isFinite(d.x) ? Math.max(m, Math.abs(d.x)) : m), 1)
  const cap = maxFinite + 1
  return raw.map(({ r, p, x }) => ({
    gene: r.gene_symbol,
    x: Number.isFinite(x) ? x : Math.sign(x) * cap,
    y: negLog10P(p),
    pLabel: pValueLabel(p),
    capped: !Number.isFinite(x),
    significant: r.q_value !== null && r.q_value < fdrThreshold
  }))
}

export function buildManhattanPoints(
  results: AssociationPlotRow[],
  primaryTest: string
): PlotPoint[] {
  const points: PlotPoint[] = []
  for (const r of results) {
    const p = primaryP(r, primaryTest)
    if (p === null) continue
    points.push({
      gene: r.gene_symbol,
      x: points.length,
      y: negLog10P(p),
      pLabel: pValueLabel(p),
      capped: false,
      significant: r.q_value !== null && r.q_value < 0.05
    })
  }
  return points
}
