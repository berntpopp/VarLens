/**
 * Point tuning (spec §11.1, anchor rule §11.9): counts from the actual first-match assignments the production
 * engine reports (`rank_mode`, `rank_evidence`), estimated with `estimatePoints`.
 *
 * Counting units: positives = training causal spike instances after the gate (one per case and
 * allele); background = distinct eligible background rows of training genes, once per
 * background. The ClinVar group is tuned on `clinvar_visible`, every other group and the modes
 * on `primary`. A mode-scoped group counts only rows scored under that mode.
 */
import { isReferenceRule } from '../../../src/shared/evidence/ruleset-problems'
import type {
  EvidenceGroup,
  EvidenceRuleset,
  ModeId
} from '../../../src/shared/types/evidence-ruleset'
import type { BinSupport, ScenarioId } from '../common/types'
import { quantile } from './bootstrap'
import { estimatePoints, type BinCount } from './points'
import { mulberry32 } from '../common/rng'

/** First-match assignment of one row: its mode and, per group, the rule that fired. */
export interface Assignment {
  gene: string
  mode: ModeId
  bins: Record<string, string>
  scenario: ScenarioId
}

export interface TuneInput {
  positives: Assignment[]
  background: Assignment[]
}

export interface TuneResult {
  ruleset: EvidenceRuleset
  support: BinSupport[]
  /** Training positives / background rows in the primary scenario. */
  A: number
  B: number
}

const MODES_GROUP = 'modes'
const usesClinvar = (g: EvidenceGroup): boolean => g.rules.some((r) => /\bclinvar\b/.test(r.when))
export const groupScenario = (g: EvidenceGroup): ScenarioId =>
  usesClinvar(g) ? 'clinvar_visible' : 'primary'

/** A cell = one bin of one group (or one mode); its population filter and the assignment test. */
interface Cell {
  group: string
  bin: string
  isReference: boolean
  /** Non-tuned template points (ClinVar bins other than P/LP, spec §15); null = tuned. */
  prior: number | null
  inPopulation: (x: Assignment) => boolean
  hit: (x: Assignment) => boolean
}

function cellsOf(template: EvidenceRuleset): Cell[] {
  const cells: Cell[] = template.modes.map((m) => ({
    group: MODES_GROUP,
    bin: m.id,
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
        isReference: isReferenceRule(r),
        // ClinVar: only the first bin (P/LP) is identifiable from P/LP-only positives.
        prior: usesClinvar(g) && k > 0 ? r.points : null,
        inPopulation: (x) =>
          x.scenario === scenario && (g.scope === 'global' || x.mode === g.scope),
        hit: (x) => x.bins[g.id] === r.id
      })
    })
  }
  return cells
}

/** Per gene: a/b counts per cell (sparse). */
type GeneCounts = Map<string, { a: Map<number, number>; b: Map<number, number> }>

function countByGene(
  cells: Cell[],
  input: TuneInput,
  isTraining: (g: string) => boolean
): GeneCounts {
  const out: GeneCounts = new Map()
  const add = (x: Assignment, side: 'a' | 'b'): void => {
    if (!isTraining(x.gene)) return
    let entry = out.get(x.gene)
    if (entry === undefined) out.set(x.gene, (entry = { a: new Map(), b: new Map() }))
    cells.forEach((c, i) => {
      if (c.inPopulation(x) && c.hit(x)) entry[side].set(i, (entry[side].get(i) ?? 0) + 1)
    })
  }
  for (const x of input.positives) add(x, 'a')
  for (const x of input.background) add(x, 'b')
  return out
}

function totals(
  cells: Cell[],
  genes: Iterable<{ a: Map<number, number>; b: Map<number, number> }>
): { a: number[]; b: number[] } {
  const a = new Array<number>(cells.length).fill(0)
  const b = new Array<number>(cells.length).fill(0)
  for (const g of genes) {
    for (const [i, n] of g.a) a[i] += n
    for (const [i, n] of g.b) b[i] += n
  }
  return { a, b }
}

type CellPoints = { raw: number; points: number; supported: boolean; isAnchor: boolean }

const REST = 'rest'

/**
 * Points per cell; each group is estimated on its own population (A, B = its row counts).
 * A group with prior cells (ClinVar) estimates its tuned bin against the pooled prior bins
 * (anchor), which keep their template points.
 */
function estimate(
  cells: Cell[],
  t: { a: number[]; b: number[] },
  anchors?: Map<string, number>
): CellPoints[] {
  const out = new Array<CellPoints>(cells.length)
  for (const group of new Set(cells.map((c) => c.group))) {
    const idx = cells.map((c, i) => (c.group === group ? i : -1)).filter((i) => i >= 0)
    const tuned = idx.filter((i) => cells[i].prior === null)
    const priors = idx.filter((i) => cells[i].prior !== null)
    const bins: BinCount[] = tuned.map((i) => ({
      id: String(i),
      a: t.a[i],
      b: t.b[i],
      isReference: cells[i].isReference
    }))
    if (priors.length > 0) {
      const sum = (xs: number[]): number => priors.reduce((acc, i) => acc + xs[i], 0)
      bins.push({ id: REST, a: sum(t.a), b: sum(t.b), isReference: true })
    }
    const A = bins.reduce((acc, x) => acc + x.a, 0)
    const B = bins.reduce((acc, x) => acc + x.b, 0)
    const fixed = priors.length > 0 ? REST : anchors?.get(group)
    const est = estimatePoints(bins, A, B, fixed === undefined ? undefined : String(fixed))
    tuned.forEach((i, k) => (out[i] = est[k]))
    for (const i of priors)
      out[i] = { raw: Number.NaN, points: cells[i].prior!, supported: false, isAnchor: false }
  }
  return out
}

/** 95 % gene-cluster bootstrap of each cell's unrounded points, relative to the fixed anchors. */
function bootstrapCells(
  cells: Cell[],
  byGene: GeneCounts,
  anchors: Map<string, number>,
  reps: number,
  seed: number
): Array<[number, number]> {
  const genes = [...byGene.keys()].sort().map((g) => byGene.get(g)!)
  const rnd = mulberry32(seed)
  const draws: number[][] = cells.map(() => [])
  for (let r = 0; r < reps; r++) {
    const sample = Array.from(
      { length: genes.length },
      () => genes[Math.floor(rnd() * genes.length)]
    )
    estimate(cells, totals(cells, sample), anchors).forEach((p, i) => {
      if (Number.isFinite(p.raw)) draws[i].push(p.raw)
    })
  }
  return draws.map((d) => {
    const s = d.sort((x, y) => x - y)
    return [quantile(s, 0.025), quantile(s, 0.975)]
  })
}

export function tuneRuleset(
  template: EvidenceRuleset,
  input: TuneInput,
  isTraining: (gene: string) => boolean,
  disabledGroups: readonly string[],
  opts: { id: string; bootstrap?: { reps: number; seed: number } }
): TuneResult {
  const cells = cellsOf(template)
  const byGene = countByGene(cells, input, isTraining)
  const t = totals(cells, byGene.values())
  const est = estimate(cells, t)
  const anchors = new Map<string, number>()
  est.forEach((p, i) => p.isAnchor && anchors.set(cells[i].group, i))
  const ci = opts.bootstrap
    ? bootstrapCells(cells, byGene, anchors, opts.bootstrap.reps, opts.bootstrap.seed)
    : null
  const support: BinSupport[] = cells.map((c, i) => {
    const disabled = disabledGroups.includes(c.group)
    return {
      group: c.group,
      bin: c.bin,
      isReference: c.isReference,
      isAnchor: est[i].isAnchor,
      tuned: c.prior === null,
      a: t.a[i],
      b: t.b[i],
      points: disabled ? 0 : est[i].points,
      supported: est[i].supported && !disabled,
      ...(ci ? { lo: ci[i][0], hi: ci[i][1] } : {})
    }
  })
  const pointsOf = (group: string, bin: string): number =>
    support.find((s) => s.group === group && s.bin === bin)?.points ?? 0
  const ruleset: EvidenceRuleset = {
    version: 1,
    id: opts.id,
    modes: template.modes.map((m) => ({ ...m, points: pointsOf(MODES_GROUP, m.id) })),
    groups: template.groups.map((g) => ({
      ...g,
      rules: g.rules.map((r) => ({ ...r, points: pointsOf(g.id, r.id) }))
    }))
  }
  const primaryPos = input.positives.filter((x) => x.scenario === 'primary' && isTraining(x.gene))
  const primaryBg = input.background.filter((x) => x.scenario === 'primary' && isTraining(x.gene))
  return { ruleset, support, A: primaryPos.length, B: primaryBg.length }
}
