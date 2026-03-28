/**
 * Inheritance mode definitions for variant filtering.
 */

/** Solo modes — always available (no family required) */
export type SoloInheritanceMode =
  | 'homozygous'
  | 'heterozygous'
  | 'x_hemizygous'
  | 'candidate_compound_het'

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
    requiresFamily: false,
    color: 'purple'
  },
  heterozygous: {
    mode: 'heterozygous',
    abbr: 'HET',
    label: 'Heterozygous',
    requiresFamily: false,
    color: 'blue'
  },
  x_hemizygous: {
    mode: 'x_hemizygous',
    abbr: 'X_HEMI',
    label: 'X-linked hemizygous',
    requiresFamily: false,
    color: 'pink'
  },
  candidate_compound_het: {
    mode: 'candidate_compound_het',
    abbr: 'CH?',
    label: 'Candidate compound het',
    requiresFamily: false,
    color: 'orange'
  },
  de_novo: {
    mode: 'de_novo',
    abbr: 'DN',
    label: 'De novo',
    requiresFamily: true,
    color: 'red'
  },
  autosomal_recessive: {
    mode: 'autosomal_recessive',
    abbr: 'AR',
    label: 'Autosomal recessive',
    requiresFamily: true,
    color: 'deep-purple'
  },
  compound_het: {
    mode: 'compound_het',
    abbr: 'CH',
    label: 'Compound het (confirmed)',
    requiresFamily: true,
    color: 'deep-orange'
  }
}
