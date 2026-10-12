/**
 * Protein view helpers shared by its entry points (details strip, header
 * buttons, row menu, `p`) and the modal's lollipop variants.
 */
import type { Variant } from '../../../shared/types/api'
import type { CohortVariant } from '../../../shared/types/cohort'
import type { LollipopVariant, ProteinDomain } from '../../../shared/types/protein'
import {
  getConsequenceCategory,
  getConsequenceColor,
  parseProteinPosition
} from '../../../shared/utils/protein-utils'
import { PROTEIN_VIEW_COPY, type ProteinViewTab } from '../config/proteinViewConfig'
import { formatHgvs } from './formatters'

type AnyVariant = Variant | CohortVariant

/**
 * Protein position and the notation it came from: aa_change first, then cdna
 * (some import formats put the protein notation in the cDNA column).
 */
export function proteinPositionOf(v: AnyVariant): { position: number; aaChange: string } | null {
  // `?? null`: rows from some sources (SV/shortlist fixtures) omit the field.
  const fromAa = parseProteinPosition(v.aa_change ?? null)
  if (fromAa !== null) return { position: fromAa, aaChange: formatHgvs(v.aa_change) ?? '' }
  const cdna = 'cdna' in v && typeof v.cdna === 'string' ? v.cdna : null
  const fromCdna = parseProteinPosition(cdna)
  return fromCdna === null ? null : { position: fromCdna, aaChange: cdna ?? '' }
}

/**
 * Why the protein view cannot open for this variant, or null when it can. A
 * variant without a protein position (SV, intronic, splice, UTR) still opens:
 * on the gene structure, which draws its genomic interval.
 */
export function proteinViewBlockedReason(
  v: AnyVariant | null,
  lookupsReason: string | null
): string | null {
  if (v === null) return PROTEIN_VIEW_COPY.noVariant
  if (lookupsReason !== null) return lookupsReason
  return v.gene_symbol === null || v.gene_symbol === '' ? PROTEIN_VIEW_COPY.noGene : null
}

/** Why this tab cannot show the variant: the lollipop and 3D need a protein position. */
export function proteinTabReason(v: AnyVariant, tab: ProteinViewTab): string | null {
  return tab !== 'gene-structure' && proteinPositionOf(v) === null
    ? PROTEIN_VIEW_COPY.noProteinPosition
    : null
}

/** The tab to open: the requested one, or the gene structure when that one cannot show it. */
export const proteinViewTabFor = (v: AnyVariant, tab: ProteinViewTab): ProteinViewTab =>
  proteinTabReason(v, tab) === null ? tab : 'gene-structure'

export const carrierLabel = (n: number): string => `${n} carrier${n === 1 ? '' : 's'}`

/** Accessible one-line summary of the mini lollipop. */
export function proteinStripSummary(
  position: number,
  length: number,
  domains: ProteinDomain[]
): string {
  const domain = domains.find((d) => d.start <= position && position <= d.end)
  return `Variant at p.${position} of ${length} in ${domain?.name ?? PROTEIN_VIEW_COPY.noDomain}`
}

function toLollipopVariant(v: AnyVariant, highlighted: boolean): LollipopVariant | null {
  const protein = proteinPositionOf(v)
  if (protein === null) return null
  const consequence = v.consequence ?? 'unknown'
  const cadd = 'cadd' in v ? (v.cadd ?? null) : 'cadd_phred' in v ? (v.cadd_phred ?? null) : null
  return {
    proteinPosition: protein.position,
    aaChange: protein.aaChange,
    consequence,
    consequenceCategory: getConsequenceCategory(consequence),
    color: getConsequenceColor(consequence),
    geneSymbol: v.gene_symbol ?? '',
    chr: v.chr,
    pos: v.pos,
    ref: v.ref,
    alt: v.alt,
    gnomadAf: v.gnomad_af ?? null,
    cadd,
    clinvar: v.clinvar ?? null,
    highlighted,
    // Cohort rows: marker size follows the number of carriers.
    carrierCount: 'carrier_count' in v ? v.carrier_count : undefined
  }
}

const sameVariant = (a: AnyVariant, b: AnyVariant): boolean =>
  a.chr === b.chr && a.pos === b.pos && a.ref === b.ref && a.alt === b.alt

/**
 * The selected variant (highlighted) plus the other variants of the gene
 * (case variants or cohort carriers), each once, without the rows that have no
 * protein position.
 */
export function buildLollipopVariants(
  selected: AnyVariant | null,
  others: AnyVariant[],
  gene: string | null
): LollipopVariant[] {
  const picked = selected !== null && selected.gene_symbol === gene ? selected : null
  const rows: Array<[AnyVariant, boolean]> = picked === null ? [] : [[picked, true]]
  for (const v of others) {
    if (v.gene_symbol === gene && (picked === null || !sameVariant(v, picked)))
      rows.push([v, false])
  }
  return rows.flatMap(([v, highlighted]) => toLollipopVariant(v, highlighted) ?? [])
}
