/**
 * Typed-array index for disease-level phenotype scoring v2 (spec §3): the HPO
 * DAG ({@link buildHpoIndex}) plus disease, NOT and gene→disease CSRs and the
 * per-term / per-annotation constants the scorer's hot loop reads. Pure.
 */
import { HPO_DATA_CONFIG } from '../config/hpo-data.config'
import { HPO_SCORING_CONFIG } from '../config/hpo-scoring.config'
import { buildHpoIndex, type HpoIndex } from './resnik'

export interface PhenotypeIndexInput {
  terms: ReadonlyArray<{ id: string; ic: number; label: string }>
  /** [child, parent] is_a edges between known terms */
  edges: ReadonlyArray<readonly [string, string]>
  /** [alias, current term] */
  aliases: ReadonlyArray<readonly [string, string]>
  /** [disease id, label] */
  diseases: ReadonlyArray<readonly [string, string]>
  /** [disease, term, f, f_excl] positive annotations */
  diseaseTerms: ReadonlyArray<readonly [string, string, number, number]>
  /** [disease, term] NOT annotations */
  diseaseNot: ReadonlyArray<readonly [string, string]>
  /** [gene symbol, disease] */
  geneDiseases: ReadonlyArray<readonly [string, string]>
}

export interface PhenotypeIndex {
  /** DAG; `hpo.genes` is the gene index, `hpo.geneTerms` the union of its diseases' terms (sprint-3 scorer). */
  hpo: HpoIndex
  termLabels: readonly string[]
  /** sim(t, t) = max float32 IC over Anc(t); the IC used to normalise (0 = uninformative term). */
  selfIc: Float64Array
  /** 1 / selfIc (0 when selfIc is 0) */
  invIc: Float64Array
  /** bit s set iff t is or descends from organ system s (a child of HP:0000118); systems ≥ 31 share bit 31 */
  systems: Uint32Array
  diseaseIds: readonly string[]
  diseaseLabels: readonly string[]
  /** annotations of d: [diseaseOffsets[d], diseaseOffsets[d + 1]) into the arrays below */
  diseaseOffsets: Int32Array
  annTerm: Int32Array
  annF: Float32Array
  annFExcl: Float32Array
  /** forward frequency factor 1 − α_f + α_f·f */
  annFactor: Float32Array
  /** Σ f over the disease's annotations */
  freqSum: Float64Array
  notOffsets: Int32Array
  notTerms: Int32Array
  /** diseases of gene g (indexed like `hpo.genes`) */
  geneOffsets: Int32Array
  geneDiseases: Int32Array
}

function groupCsr(
  n: number,
  pairs: ReadonlyArray<readonly [number, ...number[]]>
): [Int32Array, number[]] {
  const offsets = new Int32Array(n + 1)
  for (const [from] of pairs) offsets[from + 1]++
  for (let i = 0; i < n; i++) offsets[i + 1] += offsets[i]
  const fill = offsets.slice(0, n)
  const order: number[] = new Array<number>(pairs.length)
  pairs.forEach(([from], i) => (order[fill[from]++] = i))
  return [offsets, order]
}

/** selfIc, invIc and organ-system masks in one topological sweep. */
function termConstants(hpo: HpoIndex): Pick<PhenotypeIndex, 'selfIc' | 'invIc' | 'systems'> {
  const n = hpo.ids.length
  const selfIc = new Float64Array(n)
  const invIc = new Float64Array(n)
  const systems = new Uint32Array(n)
  const root = hpo.index.get(HPO_DATA_CONFIG.phenotypeRoot)
  let nextSystem = 0
  for (let i = 0; i < n; i++) {
    const t = hpo.topo[i]
    let v = Math.fround(hpo.ic[t])
    let mask = 0
    let underRoot = false
    for (let j = hpo.parentOffsets[t]; j < hpo.parentOffsets[t + 1]; j++) {
      const p = hpo.parents[j]
      if (selfIc[p] > v) v = selfIc[p]
      mask |= systems[p]
      if (p === root) underRoot = true
    }
    // ponytail: HPO has ~25 organ systems; any beyond 31 share one bit (less penalty, never more).
    if (underRoot) mask |= 1 << Math.min(nextSystem++, 31)
    selfIc[t] = v
    invIc[t] = v > 0 ? 1 / v : 0
    systems[t] = mask >>> 0
  }
  return { selfIc, invIc, systems }
}

export function buildPhenotypeIndex(input: PhenotypeIndexInput): PhenotypeIndex {
  const { alphaF } = HPO_SCORING_CONFIG
  const diseaseOrder = [...input.diseases].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  const diseaseIndex = new Map(diseaseOrder.map(([id], i) => [id, i]))
  // Gene terms (legacy scorer) = union of the gene's diseases' terms; also fixes the gene order.
  const termsOf = new Map<string, string[]>()
  for (const [d, t] of input.diseaseTerms) {
    const list = termsOf.get(d)
    if (list === undefined) termsOf.set(d, [t])
    else list.push(t)
  }
  const geneTerms: Array<[string, string]> = []
  for (const [gene, d] of input.geneDiseases) {
    for (const t of termsOf.get(d) ?? []) geneTerms.push([gene, t])
  }
  const hpo = buildHpoIndex({
    terms: input.terms,
    edges: input.edges,
    aliases: input.aliases,
    geneTerms
  })
  const consts = termConstants(hpo)
  const termOf = (id: string): number | undefined => hpo.index.get(id)

  const ann: Array<readonly [number, number, number, number]> = []
  for (const [d, id, f, fExcl] of input.diseaseTerms) {
    const di = diseaseIndex.get(d)
    const t = termOf(id)
    // An uninformative term (selfIc 0, e.g. the root) matches everything equally: skip it.
    if (di !== undefined && t !== undefined && consts.selfIc[t] > 0) ann.push([di, t, f, fExcl])
  }
  const D = diseaseOrder.length
  const [diseaseOffsets, annOrder] = groupCsr(D, ann)
  const A = ann.length
  const annTerm = new Int32Array(A)
  const annF = new Float32Array(A)
  const annFExcl = new Float32Array(A)
  const annFactor = new Float32Array(A)
  const freqSum = new Float64Array(D)
  annOrder.forEach((src, j) => {
    const [d, t, f, fExcl] = ann[src]
    annTerm[j] = t
    annF[j] = f
    annFExcl[j] = fExcl
    annFactor[j] = 1 - alphaF + alphaF * annF[j]
    freqSum[d] += annF[j]
  })

  const nots: Array<readonly [number, number]> = []
  for (const [d, id] of input.diseaseNot) {
    const di = diseaseIndex.get(d)
    const t = termOf(id)
    if (di !== undefined && t !== undefined) nots.push([di, t])
  }
  const [notOffsets, notOrder] = groupCsr(D, nots)
  const notTerms = Int32Array.from(notOrder, (src) => nots[src][1])

  const seen = new Set<string>()
  const gd: Array<readonly [number, number]> = []
  for (const [gene, d] of input.geneDiseases) {
    const g = hpo.genes.get(gene)
    const di = diseaseIndex.get(d)
    if (g === undefined || di === undefined || seen.has(`${g}:${di}`)) continue
    seen.add(`${g}:${di}`)
    gd.push([g, di])
  }
  gd.sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const [geneOffsets, gdOrder] = groupCsr(hpo.genes.size, gd)
  const geneDiseases = Int32Array.from(gdOrder, (src) => gd[src][1])

  const labelById = new Map(input.terms.map((t) => [t.id, t.label]))
  return {
    hpo,
    termLabels: hpo.ids.map((id) => labelById.get(id) ?? id),
    ...consts,
    diseaseIds: diseaseOrder.map(([id]) => id),
    diseaseLabels: diseaseOrder.map(([, label]) => label),
    diseaseOffsets,
    annTerm,
    annF,
    annFExcl,
    annFactor,
    freqSum,
    notOffsets,
    notTerms,
    geneOffsets,
    geneDiseases
  }
}
