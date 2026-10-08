/**
 * Inheritance mode definitions for variant filtering.
 */

/** Solo modes — always available (no family required) */
export type SoloInheritanceMode =
  'homozygous' | 'heterozygous' | 'x_hemizygous' | 'candidate_compound_het'

/** Trio modes — require family data */
export type TrioInheritanceMode = 'de_novo' | 'autosomal_recessive' | 'compound_het'

/** Future modes */
export type FutureInheritanceMode =
  | 'autosomal_dominant'
  | 'compound_het_denovo'
  | 'x_dominant'
  | 'x_recessive'
  | 'carrier_screening'
  | 'upd'

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
  'compound_het'
] as const

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
    help: 'Het (including assumed het calls) or haploid (1) in the proband, and neither parent has a call at the variant other than reference. A parent without a row counts as a non-carrier: reference and uncovered sites are not stored. An uncalled parent withholds the variant.',
    requiresFamily: true,
    color: 'red'
  },
  autosomal_recessive: {
    mode: 'autosomal_recessive',
    abbr: 'AR',
    label: 'Autosomal recessive',
    help: 'Homozygous (1/1) in the proband, and every parent in the analysis group is a het carrier (including assumed het calls). A parent with a reference or homozygous call, or without a row, withholds the variant: that suggests a de novo second hit, uniparental disomy or a deletion. A parent with an uncalled genotype (./.) does not, and a parent missing from the group is not checked.',
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
  }
}
