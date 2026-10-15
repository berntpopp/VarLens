/**
 * Inheritance mode definitions for variant filtering.
 */

/** Solo modes — always available (no family required) */
export type SoloInheritanceMode =
  'homozygous' | 'heterozygous' | 'x_hemizygous' | 'candidate_compound_het'

/** Trio modes — require family data */
export type TrioInheritanceMode =
  | 'de_novo'
  | 'autosomal_recessive'
  | 'compound_het'
  | 'autosomal_dominant'
  | 'x_recessive'
  | 'x_dominant'

/** Future modes */
export type FutureInheritanceMode = 'compound_het_denovo' | 'carrier_screening' | 'upd'

export type InheritanceMode = SoloInheritanceMode | TrioInheritanceMode | FutureInheritanceMode

export const SOLO_MODES: readonly SoloInheritanceMode[] = [
  'homozygous',
  'heterozygous',
  'x_hemizygous',
  'candidate_compound_het'
] as const

export const TRIO_MODES: readonly TrioInheritanceMode[] = [
  'de_novo',
  'autosomal_recessive',
  'compound_het',
  'autosomal_dominant',
  'x_recessive',
  'x_dominant'
] as const

/** A mode that needs an analysis group (family) to be evaluated. */
export function isTrioMode(mode: string): boolean {
  return (TRIO_MODES as readonly string[]).includes(mode)
}

export interface InheritanceModeMeta {
  mode: InheritanceMode
  abbr: string
  label: string
  /** What the filter selects and what it does not establish. */
  help: string
  requiresFamily: boolean
  color: string
}

export const INHERITANCE_MODE_META: Record<
  SoloInheritanceMode | TrioInheritanceMode,
  InheritanceModeMeta
> = {
  homozygous: {
    mode: 'homozygous',
    abbr: 'HOM',
    label: 'Homozygous',
    help: 'Both alleles called as this variant (1/1).',
    requiresFamily: false,
    color: 'purple'
  },
  heterozygous: {
    mode: 'heterozygous',
    abbr: 'HET',
    label: 'Heterozygous',
    help: 'One copy of the variant (0/1), including assumed het calls (1/. or ./1), whose other allele is missing.',
    requiresFamily: false,
    color: 'blue'
  },
  x_hemizygous: {
    mode: 'x_hemizygous',
    abbr: 'X_HEMI',
    label: 'X-linked hemizygous',
    help: 'On chrX: a haploid call (1), or 1/1 unless the sex of the case is female (a female 1/1 is homozygous). A case of unknown, other or unset sex keeps 1/1. Pseudoautosomal regions are not told apart.',
    requiresFamily: false,
    color: 'pink'
  },
  candidate_compound_het: {
    mode: 'candidate_compound_het',
    abbr: 'CH?',
    label: 'Candidate compound het',
    help: 'Het variants, including assumed het calls, in a gene with at least two different ones. Their phase is not known.',
    requiresFamily: false,
    color: 'orange'
  },
  de_novo: {
    mode: 'de_novo',
    abbr: 'DN',
    label: 'De novo',
    help: 'Het (including assumed het calls) or haploid (1) in the proband, or 1/1 on chrX when the sex of the case is male, and neither parent has a call at the variant other than reference. A parent without a row counts as a non-carrier: reference and uncovered sites are not stored. An uncalled parent withholds the variant.',
    requiresFamily: true,
    color: 'red'
  },
  autosomal_recessive: {
    mode: 'autosomal_recessive',
    abbr: 'AR',
    label: 'Autosomal recessive',
    help: 'Strict carrier-parents screen on autosomes: homozygous (1/1) in the proband, and every parent in the analysis group is a het carrier (including assumed het calls). A parent with a reference or homozygous call withholds the variant; so does a parent without a row, treated as reference because reference and uncovered sites are not stored. A parent with only uncalled genotypes (./.) does not. For a homozygous parent, UPD or a deletion use Homozygous.',
    requiresFamily: true,
    color: 'deep-purple'
  },
  compound_het: {
    mode: 'compound_het',
    abbr: 'CH',
    label: 'Compound het (one from each parent)',
    help: 'Het variants (including assumed het calls) of one gene inherited from opposite parents: one parent carries the variant and the other has a reference call or is without a row. Variants both parents carry, or with an uncalled parent, are left out.',
    requiresFamily: true,
    color: 'deep-orange'
  },
  autosomal_dominant: {
    mode: 'autosomal_dominant',
    abbr: 'AD',
    label: 'Autosomal dominant',
    help: 'Het (including assumed het calls) on autosomes in the proband, carried by every other affected member in the analysis group and reference or uncalled in every unaffected member. Requires at least one other affected family member.',
    requiresFamily: true,
    color: 'indigo'
  },
  x_recessive: {
    mode: 'x_recessive',
    abbr: 'XLR',
    label: 'X-linked recessive',
    help: 'On non-PAR chrX: hemizygous in a male proband or homozygous (1/1) in a female proband, with a het carrier mother (if in the group) and a reference unaffected father (if in the group).',
    requiresFamily: true,
    color: 'teal'
  },
  x_dominant: {
    mode: 'x_dominant',
    abbr: 'XLD',
    label: 'X-linked dominant',
    help: 'On non-PAR chrX: het or male hemizygous in the proband, carried by every other affected group member and reference or uncalled in every unaffected group member.',
    requiresFamily: true,
    color: 'cyan'
  }
}
