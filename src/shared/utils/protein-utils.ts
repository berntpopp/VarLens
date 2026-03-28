/**
 * Protein visualization utility functions
 * Shared between main process and renderer
 */

import type { ConsequenceCategory, ClinVarSignificance } from '../types/protein'

/**
 * Consequence category color scheme (cBioPortal convention)
 */
export const CONSEQUENCE_COLORS: Record<ConsequenceCategory, string> = {
  missense: '#008000',
  truncating: '#000000',
  inframe: '#8B4513',
  splice: '#FF8C00',
  synonymous: '#808080',
  other: '#C0C0C0'
}

/**
 * VEP consequence term → category mapping
 */
const CONSEQUENCE_CATEGORY_MAP: Record<string, ConsequenceCategory> = {
  missense_variant: 'missense',
  stop_gained: 'truncating',
  frameshift_variant: 'truncating',
  stop_lost: 'truncating',
  start_lost: 'truncating',
  inframe_deletion: 'inframe',
  inframe_insertion: 'inframe',
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

/**
 * ClinVar clinical significance color scheme
 */
export const CLINVAR_COLORS: Record<ClinVarSignificance, string> = {
  pathogenic: '#d73027',
  likely_pathogenic: '#fc8d59',
  uncertain: '#fee08b',
  likely_benign: '#91cf60',
  benign: '#1a9850',
  other: '#999999'
}

/**
 * Map a ClinVar clinical significance string to a display category
 */
export function getClinVarCategory(significance: string): ClinVarSignificance {
  const lower = significance.toLowerCase()
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
