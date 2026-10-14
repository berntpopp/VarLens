/**
 * STR phenotype score (CNV/STR spec §5): a catalogued STR call is scored only
 * against the diseases of its locus and status band, never against every
 * disease of its gene (TCF4 CTG18.1 → FECD3, not Pitt-Hopkins). Pure: the
 * benchmark imports it directly.
 */
import { HPO_LOCUS_SCORING_CONFIG } from '../config/hpo-locus-scoring.config'
import type { HpoLocusNote } from '../types/hpo-profile'
import type { LocusReference, StrBand, StrLocus } from '../types/locus-reference'
import { normalizeContigName } from '../sql/chromosome-order'
import { genotypeZygosity } from '../utils/genotype'
import { isInPAR } from '../utils/par-regions'

/** The STR fields of a pass-1 row (`LightRow`). */
export interface StrRow {
  chr: string
  pos: number
  ref: string
  end_pos?: number | null
  gene_symbol: string | null
  gt_num: string | null
  str_alt_copies?: string | null
  str_status?: string | null
  str_repeat_id?: string | null
  str_variant_catalog_id?: string | null
  str_repeat_unit?: string | null
}

export interface StrCase {
  /** `GRCh37` or `GRCh38`; any other build has no catalogue coordinates. */
  build: string
  sex: 'male' | 'female' | null
  /** The case's disease scorer; absent without HPO terms (the band is still set). */
  hpo?: { scoreDiseases(ids: readonly string[]): { score: number; disease: string } | null }
  /**
   * Distinct het alleles of the gene in the case (pass 1), the AR second hit.
   * STR rows must not be counted there, or a het expansion is its own second hit.
   */
  hetHits(gene: string): number
}

export interface StrScore {
  score: number | null
  bestDisease: string | null
  /** The STRchive id; null like the score. */
  bestLocus: string | null
  band: StrBand
  note: HpoLocusNote
}

const { str: CFG } = HPO_LOCUS_SCORING_CONFIG
const BAND_ORDER: readonly StrBand[] = ['normal', 'intermediate', 'premutation', 'full']
const BUILD_SPAN = { GRCh37: 'hg19', GRCh38: 'hg38' } as const

/** Score one STR row; null when the row is off-catalogue (every STR field null). */
export function scoreStr(row: StrRow, ref: LocusReference, cs: StrCase): StrScore | null {
  const locus = resolveLocus(row, ref.strLoci, cs.build)
  if (locus === null) return null
  const { band, alleles } = bandOf(row, locus)
  const note = locusNote(row, locus, band)
  const empty = { score: null, bestDisease: null, bestLocus: null, band, note }
  if (band === 'normal' || cs.hpo === undefined) return empty
  if (locus.evidence !== null && CFG.nullEvidence.includes(locus.evidence)) return empty
  if (!gatePasses(row, locus, alleles, cs)) return empty
  const dropped = cs.sex === 'male' ? new Set(locus.diseases.femaleOnly ?? []) : new Set()
  const ids = (band === 'full' ? locus.diseases.full : (locus.diseases[band] ?? [])).filter(
    (id) => !dropped.has(id)
  )
  const hit = cs.hpo.scoreDiseases(ids)
  if (hit === null) return empty
  return { score: hit.score, bestDisease: hit.disease, bestLocus: locus.id, band, note }
}

/**
 * Locus resolution order (§5.2): catalogue id, then repeat id (each matched to
 * the STRchive id, or to the gene with Stranger's `_n` suffix stripped), then
 * a gene with exactly one locus, then coordinate overlap in the case build.
 */
export function resolveLocus(
  row: StrRow,
  loci: readonly StrLocus[],
  build: string
): StrLocus | null {
  const overlapping = loci.filter((l) => overlaps(row, l, build))
  // A gene with several loci (e.g. HOXA13) is narrowed by coordinates.
  const pick = (cands: readonly StrLocus[]): StrLocus | null => {
    const hits = cands.length === 1 ? cands : cands.filter((l) => overlapping.includes(l))
    return hits.length === 1 ? hits[0] : null
  }
  for (const key of [row.str_variant_catalog_id, row.str_repeat_id]) {
    if (key == null || key === '') continue
    const byId = loci.find((l) => l.id === key)
    if (byId !== undefined) return byId
    const gene = key.replace(/_\d+$/, '')
    const byGene = pick(loci.filter((l) => l.gene === gene))
    if (byGene !== null) return byGene
  }
  if (row.gene_symbol != null && row.gene_symbol !== '') {
    const byGene = loci.filter((l) => l.gene === row.gene_symbol)
    if (byGene.length === 1) return byGene[0]
  }
  return overlapping.length === 1 ? overlapping[0] : null
}

function overlaps(row: StrRow, locus: StrLocus, build: string): boolean {
  const key = BUILD_SPAN[build as keyof typeof BUILD_SPAN]
  const span = key === undefined ? null : locus[key]
  if (span === null || normalizeContigName(row.chr) !== normalizeContigName(locus.chrom)) {
    return false
  }
  const end = row.end_pos ?? row.pos + Math.max(row.ref.length - 1, 0)
  return row.pos <= span.stop && end >= span.start
}

/**
 * Band and the number of alleles in it (§5.2): from the copies against the
 * catalogue thresholds, else Stranger's per-allele status; a pathogenic motif
 * mismatch is normal.
 */
export function bandOf(row: StrRow, locus: StrLocus): { band: StrBand; alleles: number } {
  if (!motifMatches(row.str_repeat_unit, locus.pathogenicMotifs)) {
    return { band: 'normal', alleles: 0 }
  }
  const copies = (row.str_alt_copies ?? '')
    .split(/[/,|]/)
    .filter((c) => c.trim() !== '')
    .map(Number)
    .filter(Number.isFinite)
  const bands =
    copies.length > 0 && locus.pathogenicMin !== null
      ? copies.map((c) => copyBand(c, locus))
      : (row.str_status ?? '').split(',').map((s) => CFG.strangerStatusBand[s.trim()] ?? 'normal')
  const band = bands.reduce((a, b) => (BAND_ORDER.indexOf(b) > BAND_ORDER.indexOf(a) ? b : a))
  let alleles = bands.filter((b) => b === band).length
  // A single status for a homozygous call stands for both alleles.
  if (copies.length === 0 && alleles === 1 && genotypeZygosity(row.gt_num) === 'hom') alleles = 2
  return { band, alleles }
}

function copyBand(c: number, l: StrLocus): StrBand {
  if (l.pathogenicMin !== null && c >= l.pathogenicMin) return 'full'
  // ponytail: the premutation range is the gap above the intermediate range,
  // only for loci with a premutation disease set (FMR1 55–199); add explicit
  // premutation thresholds to StrLocus if a second such locus appears.
  const top = l.intermediateMax ?? l.benignMax
  if (l.diseases.premutation !== undefined && top !== null && c > top) return 'premutation'
  if (l.intermediateMin !== null && c >= l.intermediateMin) return 'intermediate'
  return 'normal'
}

const COMPLEMENT: Readonly<Record<string, string>> = { A: 'T', C: 'G', G: 'C', T: 'A' }
/** Smallest rotation of the motif or its reverse complement. */
function canonicalMotif(motif: string): string {
  const m = motif.toUpperCase()
  const rc = [...m]
    .reverse()
    .map((b) => COMPLEMENT[b] ?? b)
    .join('')
  const rotations = [m, rc].flatMap((s) => [...s].map((_, i) => s.slice(i) + s.slice(0, i)))
  return rotations.sort()[0]
}

/** True when the motif is unknown, the locus lists none, or it matches one (§5.2 step 3). */
export function motifMatches(unit: string | null | undefined, motifs: readonly string[]): boolean {
  if (unit == null || unit === '' || motifs.length === 0) return true
  const c = canonicalMotif(unit)
  return motifs.some((m) => canonicalMotif(m) === c)
}

/** AR, XR and hemizygosity gates (§5.2 step 5); a dominant mode never gates. */
function gatePasses(row: StrRow, locus: StrLocus, alleles: number, cs: StrCase): boolean {
  const modes = locus.inheritance
  if (modes.length === 0 || modes.some((m) => m.includes('D'))) return true
  if (modes.includes('XR') && cs.sex === 'female') return false
  if (!modes.includes('AR')) return true
  const hemi =
    cs.sex === 'male' &&
    normalizeContigName(row.chr) === 'X' &&
    !isInPAR(row.chr, row.pos, cs.build)
  return alleles >= 2 || hemi || cs.hetHits(locus.gene) >= CFG.secondHitMin
}

function locusNote(row: StrRow, locus: StrLocus, band: StrBand): HpoLocusNote {
  const { onsetMin: a, onsetMax: b } = locus
  const onset = a !== null && b !== null ? `${a}–${b}` : (a ?? b)?.toString()
  return {
    kind: 'str',
    id: locus.id,
    label: locus.gene,
    band,
    copies: row.str_alt_copies ?? undefined,
    motif: row.str_repeat_unit ?? locus.pathogenicMotifs[0],
    inheritance: locus.inheritance.length > 0 ? locus.inheritance.join('/') : undefined,
    onset
  }
}
