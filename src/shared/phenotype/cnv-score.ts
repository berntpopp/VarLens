/**
 * CNV phenotype score (CNV/STR spec §4), pure: no Electron, no DB, so the
 * benchmark imports it directly. S_cnv = max(S_gene, S_region):
 * - gene route: dosage-weighted best gene, Šidák-corrected for the number of
 *   indexed genes the CNV hits (§4.1);
 * - region route: ClinGen regions the CNV contains, scored by their diseases (§4.2).
 */
import { HPO_LOCUS_SCORING_CONFIG as CFG } from '../config/hpo-locus-scoring.config'
import type { HpoLocusNote } from '../types/hpo-profile'
import type { DosageRegion, DosageScore, LocusReference } from '../types/locus-reference'
import { isInPAR } from '../utils/par-regions'
import { dosageScore, isDosageSensitive as sensitive } from './reference-sources'

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
  sidak(score: number, n: number): number
}

export interface CnvScoreContext {
  build: string
  sex: 'male' | 'female' | null
  /** Null without the locus tables: the score is null, the gene count still set. */
  reference: LocusReference | null
  /** Null without HPO terms or data. */
  scorer: CnvPhenotypeScorer | null
  /** Distinct het alleles of the gene in the case (pass 1). */
  hetHits(gene: string): number
}

export interface Dosage {
  hi: DosageScore
  ts: DosageScore
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

/** Dosage weight w(g, c) (§4.1 table). `biallelic`: CN 0, hemizygous loss or another het allele. */
export function dosageWeight(
  type: CnvType,
  dosage: Dosage,
  wholeGene: boolean,
  biallelic: boolean
): number {
  const del = CFG.dosageWeights.del
  const wDel = sensitive(dosage.hi)
    ? del.sensitive
    : dosage.hi === CFG.dosageScores.recessive
      ? biallelic
        ? del.recessiveBiallelic
        : del.recessive
      : dosage.hi === CFG.dosageScores.unlikely
        ? del.unlikely
        : del.unknown
  if (type === 'del') return wDel
  if (!wholeGene) return CFG.dosageWeights.dupPartialFactor * wDel
  const dup = CFG.dosageWeights.dup
  if (sensitive(dosage.ts)) return dup.sensitive
  return dosage.ts === CFG.dosageScores.unlikely ? dup.unlikely : dup.unknown
}

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

/**
 * HI/TS per gene from the row's `info_json` (AnnotSV, varlens-annotation-workflows#3),
 * keyed by upper-case symbol.
 * ponytail: assumes `SYMBOL:score` entries joined by `,` or `|`; fix with the config keys once #3 fixes its format.
 */
export function parseInfoDosage(infoJson: string | null | undefined): Map<string, Dosage> {
  const out = new Map<string, Dosage>()
  if (infoJson == null || infoJson === '') return out
  const info = JSON.parse(infoJson) as Record<string, unknown>
  for (const field of ['hi', 'ts'] as const) {
    const raw = info[CFG.annotsvInfoKeys[field]]
    if (raw == null) continue
    for (const entry of String(raw).split(/[,|]/)) {
      const [symbol, value] = entry.split(':')
      const score = dosageScore(value)
      if (symbol === undefined || symbol.trim() === '' || score === null) continue
      const key = symbol.trim().toUpperCase()
      const d = out.get(key) ?? { hi: null, ts: null }
      d[field] = score
      out.set(key, d)
    }
  }
  return out
}

interface GeneHit {
  symbol: string
  weight: number
  score: number
  dosage: string | undefined
}

function dosageLabel(type: CnvType, d: Dosage, source: string): string | undefined {
  const [name, value] = type === 'del' ? ['HI', d.hi] : ['TS', d.ts]
  return value === null ? undefined : `${name} ${value} (${source})`
}

function geneRoute(
  call: CnvCall,
  type: CnvType,
  genes: readonly CnvGene[],
  info: ReadonlyMap<string, Dosage>,
  ctx: CnvScoreContext & { reference: LocusReference; scorer: CnvPhenotypeScorer }
): { best: GeneHit; n: number } | null {
  const a = call.pos
  const b = cnvEnd(call)
  const cnLoss = call.cnv_copy_number === 0 || referenceCopyNumber(call, ctx) === 1
  const clingen = `ClinGen ${ctx.reference.sources.clingen ?? ''}`.trim()
  let best: GeneHit | null = null
  let n = 0
  for (const gene of genes) {
    const score = ctx.scorer.score(gene.symbol)
    if (score === null) continue
    const fromInfo = info.get(gene.symbol.toUpperCase())
    const curated = gene.span && ctx.reference.dosageGenes.get(gene.span.hgncId)
    // Per field: AnnotSV may carry HI without TS (or the reverse) for a gene.
    const dosage: Dosage = {
      hi: fromInfo?.hi ?? curated?.hi ?? null,
      ts: fromInfo?.ts ?? curated?.ts ?? null
    }
    const whole = gene.span !== undefined && a <= gene.span.start && gene.span.end <= b
    const biallelic = cnLoss || ctx.hetHits(gene.symbol) >= 1
    const weight = dosageWeight(type, dosage, whole, biallelic)
    if (weight <= 0) continue
    n++
    if (best === null || weight * score > best.weight * best.score) {
      const annotsv = (type === 'del' ? fromInfo?.hi : fromInfo?.ts) != null
      const label = dosageLabel(type, dosage, annotsv ? 'AnnotSV' : clingen)
      best = { symbol: gene.symbol, weight, score, dosage: label }
    }
  }
  return best === null ? null : { best, n }
}

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
  return byKey.get(`${build}\0${chr}\0${type}`) ?? []
}

function regionRoute(
  call: CnvCall,
  type: CnvType,
  ctx: CnvScoreContext & { reference: LocusReference; scorer: CnvPhenotypeScorer }
): { region: DosageRegion; cov: number; score: number; disease: string } | null {
  const chr = bareChr(call.chr)
  const a = call.pos
  const b = cnvEnd(call)
  let best: { region: DosageRegion; cov: number; score: number; disease: string } | null = null
  for (const region of sensitiveRegions(ctx.reference, ctx.build, chr, type)) {
    const cov =
      Math.max(0, Math.min(b, region.end) - Math.max(a, region.start)) / (region.end - region.start)
    const v = regionWeight(cov)
    if (v === 0) continue
    const hit = ctx.scorer.scoreDiseases(type === 'del' ? region.lossDiseases : region.gainDiseases)
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
  info: ReadonlyMap<string, Dosage>,
  ctx: CnvScoreContext
): CnvScore | null {
  const type = cnvType(call, ctx)
  if (type === null) return null
  const geneCount = new Set(genes.filter((g) => g.span?.coding === true).map((g) => g.symbol)).size
  const empty: CnvScore = { score: null, bestDisease: null, bestLocus: null, geneCount, note: null }
  const { reference, scorer } = ctx
  if (reference === null || scorer === null) return empty
  const full = { ...ctx, reference, scorer }
  const gene = geneRoute(call, type, genes, info, full)
  const region = regionRoute(call, type, full)
  const geneScore = gene === null ? -1 : gene.best.weight * scorer.sidak(gene.best.score, gene.n)
  if (region !== null && region.score > geneScore) {
    const { region: r, cov } = region
    const dosage = type === 'del' ? r.hi : r.ts
    const clingen = `ClinGen ${reference.sources.clingen ?? ''}`.trim()
    return {
      score: region.score,
      bestDisease: region.disease,
      bestLocus: r.iscaId,
      geneCount,
      note: {
        kind: 'region',
        id: r.iscaId,
        label: r.label,
        dosage: `${type === 'del' ? 'HI' : 'TS'} ${dosage} (${clingen})`,
        coverage: cov,
        diseaseGenes: gene?.n ?? 0,
        genes: geneCount
      }
    }
  }
  if (gene === null) return empty
  const { best, n } = gene
  return {
    score: geneScore,
    bestDisease: scorer.bestDisease(best.symbol),
    bestLocus: best.symbol,
    geneCount,
    note: {
      kind: 'gene',
      id: best.symbol,
      label: best.symbol,
      dosage: best.dosage,
      diseaseGenes: n,
      genes: geneCount
    }
  }
}
