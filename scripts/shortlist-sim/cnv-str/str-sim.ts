/**
 * Synthetic STR cases of the CNV/STR benchmark (spec §7.2, protocol "STR"): a normal call at every
 * catalogue locus, population-rate decoys, a causal expansion, and the T1–T5 trick arms. GRCh38.
 */
import type { StrRow } from '../../../src/shared/phenotype/str-score'
import type { StrBand, StrLocus } from '../../../src/shared/types/locus-reference'

export type Sex = 'male' | 'female'

/** Decoy loci and their population rates (protocol; FMR1 per sex). */
export const DECOYS = {
  tcf4: { id: 'FECD3_TCF4', rate: 0.03 },
  atxn2: { id: 'SCA2_ATXN2', rate: 0.04 },
  rfc1: { id: 'CANVAS_RFC1', rate: 0.02 },
  fmr1: { id: 'FXS_FMR1', rate: { female: 0.004, male: 0.002 } }
} as const

export const NULL_EVIDENCE = new Set(['Refuted', 'Disputed'])
const int = (rnd: () => number, lo: number, hi: number): number =>
  lo + Math.floor(rnd() * (hi - lo + 1))

/** Upper end of the normal draw: benignMax, else intermediateMin − 1, else pathogenicMin − 1, else 10. */
export function normalMax(l: StrLocus): number {
  const n = l.benignMax ?? (l.intermediateMin ?? l.pathogenicMin ?? 11) - 1
  return Math.max(1, n)
}

const hemizygous = (l: StrLocus, sex: Sex | null): boolean => sex === 'male' && l.chrom === 'X'
export const normalAllele = (l: StrLocus, rnd: () => number): number => int(rnd, 1, normalMax(l))
/** pathogenicMin + U[0, pathogenicMin]. */
export const fullAllele = (l: StrLocus, rnd: () => number): number =>
  l.pathogenicMin! + int(rnd, 0, l.pathogenicMin!)

/** One STR row of a locus with the given alleles (one allele for a hemizygous male). */
export function strRow(l: StrLocus, alleles: number[]): StrRow {
  return {
    chr: l.chrom,
    pos: l.hg38!.start,
    end_pos: l.hg38!.stop,
    ref: 'N',
    gene_symbol: l.gene,
    gt_num: alleles.length === 1 ? '1' : '1/2',
    str_alt_copies: alleles.join('/'),
    str_status: null,
    str_repeat_id: null,
    str_variant_catalog_id: l.id,
    str_repeat_unit: l.pathogenicMotifs[0] ?? null
  }
}

/** Alleles of one locus: `special` replaces one allele (both when `biallelic`). */
export function alleles(
  l: StrLocus,
  sex: Sex | null,
  rnd: () => number,
  special?: { value: () => number; biallelic?: boolean }
): number[] {
  if (hemizygous(l, sex)) return [special ? special.value() : normalAllele(l, rnd)]
  if (special === undefined) return [normalAllele(l, rnd), normalAllele(l, rnd)]
  return [special.value(), special.biallelic === true ? special.value() : normalAllele(l, rnd)]
}

/** A decoy allele generator per decoy locus. */
export function decoyValue(key: keyof typeof DECOYS, l: StrLocus, rnd: () => number): () => number {
  if (key === 'atxn2') return () => int(rnd, l.intermediateMin!, l.intermediateMax!)
  if (key === 'fmr1') return () => int(rnd, (l.intermediateMax ?? 54) + 1, l.pathogenicMin! - 1)
  return () => fullAllele(l, rnd)
}

/** Decoys present in one case at population rates (`all`: every decoy, the sensitivity arm). */
export function drawDecoys(
  sex: Sex | null,
  rnd: () => number,
  all = false
): Array<keyof typeof DECOYS> {
  return (Object.keys(DECOYS) as Array<keyof typeof DECOYS>).filter((k) => {
    const d = DECOYS[k]
    const rate = typeof d.rate === 'number' ? d.rate : d.rate[sex ?? 'female']
    const u = rnd() // drawn for every decoy, so `all` keeps the same stream
    return all || u < rate
  })
}

/** Recessive-only inheritance: AR without any dominant mode. */
export const recessiveOnly = (l: StrLocus): boolean =>
  l.inheritance.includes('AR') && !l.inheritance.some((m) => m.includes('D'))

/** Causal loci: a pathogenic threshold, a scoring evidence level and an annotated full disease. */
export function causalLoci(
  loci: readonly StrLocus[],
  hasTerms: (id: string) => boolean
): StrLocus[] {
  return loci.filter(
    (l) =>
      l.hg38 !== null &&
      l.pathogenicMin !== null &&
      !NULL_EVIDENCE.has(l.evidence ?? '') &&
      l.diseases.full.some(hasTerms)
  )
}

/** The band's disease set a row may name (the false-lead check), `femaleOnly` dropped for males. */
export function allowedDiseases(l: StrLocus, band: StrBand, sex: Sex | null): Set<string> {
  const ids = band === 'normal' ? [] : band === 'full' ? l.diseases.full : (l.diseases[band] ?? [])
  const dropped = sex === 'male' ? new Set(l.diseases.femaleOnly ?? []) : new Set<string>()
  return new Set(ids.filter((id) => !dropped.has(id)))
}
