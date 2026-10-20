/**
 * Protein visualization utility functions
 * Shared between main process and renderer
 */

import type { ConsequenceCategory, ClinVarSignificance } from '../types/protein'
import { CLINVAR_OTHER_MARK, CONSEQUENCE_COLORS, SEMANTIC_COLORS } from '../config/domain.config'

/**
 * VEP consequence term → category mapping
 */
const CONSEQUENCE_CATEGORY_MAP: Record<string, ConsequenceCategory> = {
  missense_variant: 'missense',
  stop_gained: 'truncating',
  frameshift_variant: 'truncating',
  frameshift_truncation: 'truncating',
  frameshift_elongation: 'truncating',
  stop_lost: 'truncating',
  start_lost: 'truncating',
  inframe_indel: 'inframe',
  inframe_deletion: 'inframe',
  inframe_insertion: 'inframe',
  disruptive_inframe_deletion: 'inframe',
  disruptive_inframe_insertion: 'inframe',
  conservative_inframe_deletion: 'inframe',
  conservative_inframe_insertion: 'inframe',
  splice_donor_variant: 'splice',
  splice_acceptor_variant: 'splice',
  splice_region_variant: 'splice',
  synonymous_variant: 'synonymous',
  // VEP impact levels (used by some import formats instead of specific terms)
  HIGH: 'truncating',
  MODERATE: 'missense',
  LOW: 'synonymous',
  MODIFIER: 'other'
}

/**
 * InterPro domain type color scheme
 */
export const DOMAIN_TYPE_COLORS: Record<string, string> = {
  domain: '#7B1FA2',
  region: '#00796B',
  motif: '#F57C00',
  transmembrane: '#C62828',
  signal: '#1565C0',
  propeptide: '#558B2F',
  chain: '#455A64',
  repeat: '#6A1B9A',
  'zinc finger': '#0277BD',
  'coiled coil': '#EF6C00'
}

/** Colour of an InterPro domain type (grey for types without one). */
export const getDomainColor = (type: string): string =>
  DOMAIN_TYPE_COLORS[type.toLowerCase()] ?? '#9E9E9E'

/**
 * ClinVar clinical significance colours for the protein plots, gene structure
 * and Mol*: the light ACMG tokens, since these figures always render on a
 * light surface (and export as such). `other` is a lighter neutral so it does
 * not read as VUS.
 */
export const CLINVAR_COLORS: Record<ClinVarSignificance, string> = {
  pathogenic: SEMANTIC_COLORS.light.error,
  likely_pathogenic: SEMANTIC_COLORS.light['acmg-lp'],
  uncertain: SEMANTIC_COLORS.light.muted,
  likely_benign: SEMANTIC_COLORS.light['acmg-lb'],
  benign: SEMANTIC_COLORS.light['acmg-b'],
  other: CLINVAR_OTHER_MARK
}

export type ClinVarShape = 'triangle' | 'diamond' | 'circle' | 'square' | 'cross' | 'wye'

/**
 * Marker shape per class, the cue next to colour (#572, WCAG 1.4.1): classes
 * stay apart in greyscale and for colour-blind readers. Plots and legends both
 * read it (src/renderer/src/utils/clinvar-mark.ts).
 */
export const CLINVAR_SHAPES: Record<ClinVarSignificance, ClinVarShape> = {
  pathogenic: 'triangle',
  likely_pathogenic: 'diamond',
  uncertain: 'circle',
  likely_benign: 'square',
  benign: 'cross',
  other: 'wye'
}

/**
 * Map a ClinVar clinical significance string to a display category
 */
export function getClinVarCategory(significance: string): ClinVarSignificance {
  const lower = significance.toLowerCase()
  // "Conflicting classifications of pathogenicity" is not a pathogenic call.
  if (lower.includes('conflicting')) return 'other'
  if (lower.includes('pathogenic') && !lower.includes('likely')) return 'pathogenic'
  if (lower.includes('likely') && lower.includes('pathogenic')) return 'likely_pathogenic'
  if (lower.includes('uncertain') || lower.includes('vus')) return 'uncertain'
  if (lower.includes('likely') && lower.includes('benign')) return 'likely_benign'
  if (lower.includes('benign') && !lower.includes('likely')) return 'benign'
  return 'other'
}

/**
 * Parse amino acid position from HGVS protein notation
 *
 * @example
 * parseProteinPosition('p.Ala123Val')  // 123
 * parseProteinPosition('p.R248W')      // 248
 * parseProteinPosition('p.Ter315ext*') // 315
 * parseProteinPosition('p.?')          // null
 * parseProteinPosition(null)           // null
 */
export function parseProteinPosition(aaChange: string | null): number | null {
  if (aaChange === null || aaChange === '') return null
  const match = aaChange.match(/p\.\D*?(\d+)/)
  return match ? parseInt(match[1], 10) : null
}

/**
 * Map a VEP consequence term to a display category
 */
export function getConsequenceCategory(consequence: string): ConsequenceCategory {
  return CONSEQUENCE_CATEGORY_MAP[consequence] ?? 'other'
}

/**
 * Get the display color for a VEP consequence term
 */
export function getConsequenceColor(consequence: string): string {
  const category = getConsequenceCategory(consequence)
  return CONSEQUENCE_COLORS[category]
}
