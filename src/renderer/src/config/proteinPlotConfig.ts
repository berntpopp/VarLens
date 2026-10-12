/**
 * Navigation, search and copy for the protein lollipop and gene-structure
 * views (one source; code and tests read it). Coordinates are amino acids in
 * the lollipop and base pairs in the gene structure.
 */
import type { ClinVarSignificance } from '../../../shared/types/protein'

/** HGVS three-letter amino-acid codes → one-letter codes (search accepts both). */
export const AA_THREE_TO_ONE: Readonly<Record<string, string>> = {
  Ala: 'A', Arg: 'R', Asn: 'N', Asp: 'D', Cys: 'C', Gln: 'Q', Glu: 'E', Gly: 'G', His: 'H',
  Ile: 'I', Leu: 'L', Lys: 'K', Met: 'M', Phe: 'F', Pro: 'P', Ser: 'S', Thr: 'T', Trp: 'W',
  Tyr: 'Y', Val: 'V', Sec: 'U', Pyl: 'O', Ter: '*'
} // prettier-ignore

/** Accepted search inputs, tried in this order; anything else is a domain / name search. */
export const TRACK_SEARCH_PATTERNS = {
  /** "180", "p.180" */
  proteinPosition: /^(?:p\.)?(\d+)$/i,
  /** "Met180Val", "M180V", "p.Met180Val", "p.Arg42*", "R42Ter" (codes checked against AA_THREE_TO_ONE) */
  aaChange: /^(?:p\.)?\(?([a-z]{3}|[a-z*])(\d+)([a-z]{3}|[a-z*=])\)?$/i,
  /** "c.538A>G" (matched against the variants' cDNA notation) */
  cdna: /^c\.(\S+)$/i,
  /** "exon 5", "exon5", "e5" */
  exon: /^(?:exon\s*|e)(\d+)$/i,
  /** "chr22:29539391", "22:29,539,391" */
  genomic: /^(?:chr)?([0-9]{1,2}|[XYM]|MT):([\d,]+)$/i
} as const

/** Smallest window: zooming stops here (aa or bp). */
export const MIN_WINDOW = { protein: 10, gene: 50 } as const

/** Neighbourhood around the variant of interest (± this much), first entry is the default. */
export const NEIGHBOURHOOD_HALF_WIDTHS = {
  protein: [25, 10, 50, 100],
  gene: [2000, 500, 10000, 50000]
} as const

/** Zoom factor per +/− (or a wheel notch, which uses its square root) and pan step. */
export const ZOOM_STEP = 1.5
export const PAN_FRACTION = 0.2

/** Zoomed out, more markers than this in view are binned (the variant of interest never is). */
export const MAX_MARKERS_UNBINNED = 250
/** Width of one bin on screen when binning (px). */
export const BIN_PX = 6

/** Left gutter of the plots, wide enough for the track labels. */
export const TRACK_GUTTER_PX = 104

/** Track labels (left gutter). */
export const TRACK_LABELS = {
  domains: 'Domains',
  exons: 'Exons',
  variant: 'Your variants',
  cohort: 'Cohort carriers',
  clinvar: 'ClinVar',
  gnomad: 'gnomAD'
} as const

export const CLINVAR_CLASS_LABELS: Readonly<Record<ClinVarSignificance, string>> = {
  pathogenic: 'Pathogenic',
  likely_pathogenic: 'Likely pathogenic',
  uncertain: 'VUS',
  likely_benign: 'Likely benign',
  benign: 'Benign',
  other: 'Other'
}

export const PLOT_COPY = {
  proteinAxis: 'Amino-acid position',
  searchLabel: 'Find variant, position or domain',
  geneSearchLabel: 'Find exon, variant or position',
  searchHint: 'e.g. 180 · p.180 · M180V · Met180Val · a domain name · c.538A>G · chr22:29539391',
  geneSearchHint: 'e.g. exon 5 · chr22:29539391 · c.538A>G · M180V · 180 (residue)',
  noMatch: 'No match',
  between: 'between domains',
  betweenExons: 'in an intron',
  noDomains: 'no annotated domains',
  noExons: 'no exon data',
  outside: 'outside the gene',
  setAnchor: 'Set as variant of interest',
  backToAnchor: 'Back to the original variant',
  zoomToAnchor: 'Zoom to the variant of interest',
  list: 'List',
  plot: 'Plot',
  nearby: 'Nearby variants',
  noNearby: 'No other variants in this window',
  keyboardHint:
    '+ / − zoom · ← / → pan · Home reset · Tab to a variant, then ← / → step · Esc back to the plot'
} as const

/** Columns of the variant list (List view and Nearby variants). */
export const VARIANT_LIST_HEADERS = {
  position: 'Position',
  distance: 'Distance',
  change: 'Variant',
  track: 'Track',
  clinvar: 'ClinVar',
  carriers: 'Carriers',
  source: 'Source'
} as const

export function proteinCaption(gene: string, length: number, cohort: boolean): string {
  const size = cohort ? 'height = carriers' : 'height = number of variants'
  return `Each lollipop is a variant on the ${gene} protein (${length} aa); ${size}, colour = consequence; ◆ ClinVar, colour = class.`
}

export function geneCaption(gene: string, exons: number, transcript: string): string {
  return `${gene} (${transcript}, ${exons} exons): boxes are exons, the line is introns; your variant in red, ◆ ClinVar, colour = class.`
}

/** "±25 aa: 3 Pathogenic, 1 VUS · 4 cohort variants, 9 carriers" header unit. */
export const unitOf = (view: 'protein' | 'gene'): string => (view === 'protein' ? 'aa' : 'bp')
