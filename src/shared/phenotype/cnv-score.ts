/**
 * CNV phenotype score (CNV/STR spec §4, #642), pure: no Electron, no DB, so the
 * benchmark imports it directly. S_cnv = max(S_gene, S_region):
 * - gene route: plain best overlapped gene max_{g in G(c)} S(g) (§4.1, #642);
 * - region route: ClinGen regions the CNV contains, scored by their diseases (§4.2).
 */
import { HPO_LOCUS_SCORING_CONFIG as CFG } from '../config/hpo-locus-scoring.config'
import type { HpoLocusNote } from '../types/hpo-profile'
import type { DosageRegion, LocusReference } from '../types/locus-reference'
import { isInPAR } from '../utils/par-regions'
import { isDosageSensitive as sensitive } from './reference-sources'

export type CnvType = 'del' | 'dup'

/** One gene interval of `gene_reference.db` (both builds; chr without `chr`). */
export interface GeneSpan {
  chr: string
  start: number
  end: number
  symbol: string
  hgncId: string
  coding: boolean
}

/** Gene-interval index of one build (`src/main/services/reference/gene-intervals.ts`). */
export interface GeneSpanLookup {
  /** Every span overlapping [a, b] on chr, ordered by start. */
  overlapping(chr: string, a: number, b: number): GeneSpan[]
  /** The span of a symbol or HGNC id on chr (whole-gene containment, HGNC id for ClinGen). */
  span(symbol: string, chr: string): GeneSpan | undefined
}

/** A gene of the CNV: span is absent when a CSQ symbol is unknown to the gene reference. */
export interface CnvGene {
  symbol: string
  span?: GeneSpan
}

/** The CNV row fields the score reads (a subset of `LightRow`). */
export interface CnvCall {
  chr: string
  pos: number
  end_pos?: number | null
  sv_length?: number | null
  sv_type?: string | null
  cnv_copy_number?: number | null
}

/** Structural subset of `HpoGeneScorer`. */
export interface CnvPhenotypeScorer {
  score(gene: string): number | null
  bestDisease(gene: string): string | null
  scoreDiseases(ids: readonly string[]): { score: number; disease: string } | null
}

export interface CnvScoreContext {
  build: string
  sex: 'male' | 'female' | null
  /** Null without the locus tables: the score is null, the gene count still set. */
  reference: LocusReference | null
  /** Null without HPO terms or data. */
  scorer: CnvPhenotypeScorer | null
}

export interface CnvScore {
  score: number | null
  bestDisease: string | null
  bestLocus: string | null
  /** Protein-coding genes of the gene set (Riggs 3A–C), with or without HPO terms. */
  geneCount: number
  note: HpoLocusNote | null
}

const bareChr = (chr: string): string => chr.replace(/^chr/i, '').toUpperCase()

/** Reference copy number: 1 on chrX/chrY outside the PARs in a male, else 2. */
function referenceCopyNumber(call: CnvCall, ctx: Pick<CnvScoreContext, 'build' | 'sex'>): number {
  const chr = bareChr(call.chr)
  const haploid =
    ctx.sex === 'male' && (chr === 'X' || chr === 'Y') && !isInPAR(call.chr, call.pos, ctx.build)
  return haploid ? 1 : CFG.referenceCopyNumber
}

/** DEL or DUP from `sv_type`, else copy number against the reference CN; null for INV/BND/INS. */
export function cnvType(
  call: CnvCall,
  ctx: Pick<CnvScoreContext, 'build' | 'sex'>
): CnvType | null {
  const sv = (call.sv_type ?? '').toUpperCase()
  if (sv.startsWith('DEL')) return 'del'
  if (sv.startsWith('DUP')) return 'dup'
  if (sv !== '' && sv !== 'CNV') return null
  const cn = call.cnv_copy_number
  if (cn == null) return null
  const ref = referenceCopyNumber(call, ctx)
  return cn < ref ? 'del' : cn > ref ? 'dup' : null
}

/** b = end_pos, else pos + |sv_length|. */
export const cnvEnd = (call: CnvCall): number =>
  call.end_pos ?? call.pos + Math.abs(call.sv_length ?? 0)

/** v(cov) (§4.2): 1 at ≥ full, linear from min to full, 0 below min. */
export function regionWeight(cov: number): number {
  const { full, min } = CFG.regionCoverage
  if (cov >= full) return 1
  return cov < min ? 0 : (cov - min) / (full - min)
}

/**
 * The CNV's gene set (§4): the distinct CSQ genes when present, else the
 * gene-interval overlap of [a, b]. CSQ genes get their span for containment;
 * a CSQ gene whose span misses [a, b] (VEP's up/downstream genes within 5 kb) is dropped.
 */
export function cnvGeneSet(
  csqGenes: readonly string[] | undefined,
  lookup: GeneSpanLookup,
  chr: string,
  a: number,
  b: number
): CnvGene[] {
  if (csqGenes === undefined || csqGenes.length === 0) {
    return lookup.overlapping(chr, a, b).map((span) => ({ symbol: span.symbol, span }))
  }
  return [...new Set(csqGenes)]
    .map((symbol) => ({ symbol, span: lookup.span(symbol, chr) }))
    .filter(({ span }) => span === undefined || (span.start <= b && span.end >= a))
}

interface GeneHit {
  symbol: string
  score: number
}

function geneRoute(
  genes: readonly CnvGene[],
  scorer: CnvPhenotypeScorer
): { best: GeneHit; n: number } | null {
  let best: GeneHit | null = null
  let n = 0
  for (const gene of genes) {
    const score = scorer.score(gene.symbol)
    if (score === null) continue
    n++
    if (best === null || score > best.score) {
      best = { symbol: gene.symbol, score }
    }
  }
  return best === null ? null : { best, n }
}

const NO_REGIONS: readonly DosageRegion[] = []

/** Dosage-sensitive regions per `build\0chr\0type`, built once per reference (5,000 CNVs per case). */
const regionCache = new WeakMap<LocusReference, Map<string, DosageRegion[]>>()
function sensitiveRegions(ref: LocusReference, build: string, chr: string, type: CnvType) {
  let byKey = regionCache.get(ref)
  if (byKey === undefined) {
    byKey = new Map()
    for (const r of ref.dosageRegions) {
      if (r.end <= r.start) continue
      for (const t of ['del', 'dup'] as const) {
        if (!sensitive(t === 'del' ? r.hi : r.ts)) continue
        const key = `${r.build}\0${bareChr(r.chr)}\0${t}`
        byKey.set(key, [...(byKey.get(key) ?? []), r])
      }
    }
    regionCache.set(ref, byKey)
  }
  return byKey.get(`${build}\0${chr}\0${type}`) ?? NO_REGIONS
}

function regionRoute(
  call: CnvCall,
  type: CnvType,
  regions: readonly DosageRegion[],
  scorer: CnvPhenotypeScorer
): { region: DosageRegion; cov: number; score: number; disease: string } | null {
  const a = call.pos
  const b = cnvEnd(call)
  let best: { region: DosageRegion; cov: number; score: number; disease: string } | null = null
  for (const region of regions) {
    const cov =
      Math.max(0, Math.min(b, region.end) - Math.max(a, region.start)) / (region.end - region.start)
    const v = regionWeight(cov)
    if (v === 0) continue
    const hit = scorer.scoreDiseases(type === 'del' ? region.lossDiseases : region.gainDiseases)
    if (hit !== null && (best === null || v * hit.score > best.score)) {
      best = { region, cov, score: v * hit.score, disease: hit.disease }
    }
  }
  return best
}

/**
 * S_cnv (§4.3). Null for INV/BND/INS and calls that are neither loss nor gain;
 * the score fields are null without the locus reference or an HPO scorer.
 */
export function scoreCnv(
  call: CnvCall,
  genes: readonly CnvGene[],
  ctx: CnvScoreContext
): CnvScore | null {
  const type = cnvType(call, ctx)
  if (type === null) return null
  let codingCount = 0
  for (const g of genes) if (g.span?.coding === true) codingCount++
  const empty: CnvScore = {
    score: null,
    bestDisease: null,
    bestLocus: null,
    geneCount: codingCount,
    note: null
  }
  const { reference, scorer } = ctx
  if (reference === null || scorer === null) return empty
  const regions = sensitiveRegions(reference, ctx.build, bareChr(call.chr), type)
  if (genes.length === 0 && regions.length === 0) return empty
  const gene = genes.length === 0 ? null : geneRoute(genes, scorer)
  const region = regions.length === 0 ? null : regionRoute(call, type, regions, scorer)
  const geneScore = gene === null ? -1 : gene.best.score
  if (region !== null && region.score > geneScore) {
    const { region: r, cov } = region
    const dosage = type === 'del' ? r.hi : r.ts
    const clingen = `ClinGen ${reference.sources.clingen ?? ''}`.trim()
    return {
      score: region.score,
      bestDisease: region.disease,
      bestLocus: r.iscaId,
      geneCount: codingCount,
      note: {
        kind: 'region',
        id: r.iscaId,
        label: r.label,
        dosage: `${type === 'del' ? 'HI' : 'TS'} ${dosage} (${clingen})`,
        coverage: cov,
        diseaseGenes: gene?.n ?? 0,
        genes: codingCount
      }
    }
  }
  if (gene === null) return empty
  const { best, n } = gene
  return {
    score: geneScore,
    bestDisease: scorer.bestDisease(best.symbol),
    bestLocus: best.symbol,
    geneCount: codingCount,
    note: {
      kind: 'gene',
      id: best.symbol,
      label: best.symbol,
      diseaseGenes: n,
      genes: codingCount
    }
  }
}
