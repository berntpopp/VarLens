/**
 * Joint L2-regularized Newton-IRLS logistic regression over the one-hot rule partition
 * `cellsOf(template)` (#640). Decorrelates collinear rule groups while keeping 0 points on each
 * group's reference/otherwise bin.
 */
import { SHORTLIST_EVIDENCE_CONFIG } from '../../../src/shared/config/shortlist-evidence.config'
import { isReferenceRule } from '../../../src/shared/evidence/ruleset-problems'
import type { EvidenceGroup, EvidenceRuleset } from '../../../src/shared/types/evidence-ruleset'
import type { BinSupport, ScenarioId } from '../common/types'
import { groupScenario, type Assignment, type TuneInput, type TuneResult } from './tune'

const MODES_GROUP = 'modes'
const usesClinvar = (g: EvidenceGroup): boolean => g.rules.some((r) => /\bclinvar\b/.test(r.when))

interface Cell {
  group: string
  bin: string
  scenario: ScenarioId
  isReference: boolean
  prior: number | null
  inPopulation: (x: Assignment) => boolean
  hit: (x: Assignment) => boolean
}

export function cellsOf(template: EvidenceRuleset): Cell[] {
  const cells: Cell[] = template.modes.map((m) => ({
    group: MODES_GROUP,
    bin: m.id,
    scenario: 'primary',
    isReference: m.id === 'fallback',
    prior: null,
    inPopulation: (x) => x.scenario === 'primary',
    hit: (x) => x.mode === m.id
  }))
  for (const g of template.groups) {
    const scenario = groupScenario(g)
    g.rules.forEach((r, k) => {
      cells.push({
        group: g.id,
        bin: r.id,
        scenario,
        isReference: isReferenceRule(r),
        prior: usesClinvar(g) && k > 0 ? r.points : null,
        inPopulation: (x) =>
          x.scenario === scenario && (g.scope === 'global' || x.mode === g.scope),
        hit: (x) => x.bins[g.id] === r.id
      })
    })
  }
  return cells
}

export function roundLogisticPoints(v: number): number {
  const { min, max } = SHORTLIST_EVIDENCE_CONFIG.points
  const r = (Math.sign(v) * Math.round(Math.abs(v) * 2)) / 2
  return Math.min(max, Math.max(min, r)) + 0
}

function solve(A: number[][], b: number[]): number[] {
  const p = b.length
  const M = A.map((row, i) => [...row, b[i]])
  for (let c = 0; c < p; c++) {
    let piv = c
    for (let r = c + 1; r < p; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r
    ;[M[c], M[piv]] = [M[piv], M[c]]
    const div = M[c][c] || 1e-12
    for (let j = c; j <= p; j++) M[c][j] /= div
    for (let r = 0; r < p; r++) {
      if (r === c || M[r][c] === 0) continue
      const f = M[r][c]
      for (let j = c; j <= p; j++) M[r][j] -= f * M[c][j]
    }
  }
  return M.map((row) => row[p])
}

export function fitLogisticPoints(
  template: EvidenceRuleset,
  input: TuneInput,
  isTraining: (gene: string) => boolean = () => true,
  disabledGroups: readonly string[] = [],
  opts: { id?: string; lambda?: number } = {}
): TuneResult {
  const lambda = opts.lambda ?? 1
  const cells = cellsOf(template)
  const a = new Array<number>(cells.length).fill(0)
  const b = new Array<number>(cells.length).fill(0)
  for (const x of input.positives)
    if (isTraining(x.gene)) cells.forEach((c, i) => c.inPopulation(x) && c.hit(x) && a[i]++)
  for (const x of input.background)
    if (isTraining(x.gene)) cells.forEach((c, i) => c.inPopulation(x) && c.hit(x) && b[i]++)

  const rawByCell = new Array<number>(cells.length).fill(0)
  for (const scenario of ['primary', 'clinvar_visible'] as const) {
    const active = cells
      .map((c, i) =>
        c.scenario === scenario &&
        !c.isReference &&
        c.prior === null &&
        !disabledGroups.includes(c.group) &&
        a[i] + b[i] > 0
          ? i
          : -1
      )
      .filter((i) => i >= 0)
    if (active.length === 0) continue
    const patterns = new Map<string, { cols: number[]; y1: number; n: number }>()
    const addRows = (rows: Assignment[], isPos: boolean): void => {
      for (const x of rows) {
        if (x.scenario !== scenario || !isTraining(x.gene)) continue
        const cols = [0]
        active.forEach((ci, k) => {
          if (cells[ci].inPopulation(x) && cells[ci].hit(x)) cols.push(k + 1)
        })
        const key = cols.join(',')
        let pat = patterns.get(key)
        if (pat === undefined) patterns.set(key, (pat = { cols, y1: 0, n: 0 }))
        if (isPos) pat.y1++
        pat.n++
      }
    }
    addRows(input.positives, true)
    addRows(input.background, false)
    if (patterns.size === 0) continue

    const p = active.length + 1
    const beta = new Array<number>(p).fill(0)
    for (let iter = 0; iter < 25; iter++) {
      const H = Array.from({ length: p }, (_, i) => {
        const row = new Array<number>(p).fill(0)
        row[i] = i === 0 ? 1e-9 : lambda
        return row
      })
      const g = beta.map((v, i) => (i === 0 ? 0 : -lambda * v))
      for (const { cols, y1, n } of patterns.values()) {
        let eta = 0
        for (const c of cols) eta += beta[c]
        const mu = 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, eta))))
        const r = y1 - n * mu
        const w = n * mu * (1 - mu)
        for (const j of cols) {
          g[j] += r
          for (const k of cols) H[j][k] += w
        }
      }
      const delta = solve(H, g)
      let maxD = 0
      for (let j = 0; j < p; j++) {
        beta[j] += delta[j]
        maxD = Math.max(maxD, Math.abs(delta[j]))
      }
      if (maxD < 1e-8) break
    }
    active.forEach((ci, k) => {
      rawByCell[ci] = beta[k + 1] / Math.LN2
    })
  }

  const support: BinSupport[] = cells.map((c, i) => {
    const disabled = disabledGroups.includes(c.group)
    const supported = !disabled && c.prior === null && a[i] + b[i] > 0
    const points = disabled
      ? 0
      : c.prior !== null
        ? c.prior
        : c.isReference || !supported
          ? 0
          : roundLogisticPoints(rawByCell[i])
    return {
      group: c.group,
      bin: c.bin,
      isReference: c.isReference,
      isAnchor: c.isReference,
      tuned: c.prior === null,
      a: a[i],
      b: b[i],
      points,
      supported
    }
  })
  const pointsOf = (group: string, bin: string): number =>
    support.find((s) => s.group === group && s.bin === bin)?.points ?? 0
  const ruleset: EvidenceRuleset = {
    version: 1,
    id: opts.id ?? `${template.id}-logistic`,
    modes: template.modes.map((m) => ({ ...m, points: pointsOf(MODES_GROUP, m.id) })),
    groups: template.groups.map((g) => ({
      ...g,
      rules: g.rules.map((r) => ({ ...r, points: pointsOf(g.id, r.id) }))
    }))
  }
  const A = input.positives.filter((x) => x.scenario === 'primary' && isTraining(x.gene)).length
  const B = input.background.filter((x) => x.scenario === 'primary' && isTraining(x.gene)).length
  return { ruleset, support, A, B }
}
