/**
 * Project a VEP annotation into the varvis (Jannovar-style) vocabulary using only the empirical
 * mapping measured in the offline concordance study (spec §4.4). Nothing is invented: a term
 * without enough support is `unmapped`.
 */

export type AlleleClass = 'snv' | 'mnv' | 'ins' | 'del' | 'delins'

export interface FuncMappingRow {
  /** VEP consequence terms of the picked transcript joined with '&' (VEP order). */
  vepTerm: string
  alleleClass: AlleleClass
  varvisFunc: string
  count: number
}

export interface ImpactRow {
  varvisFunc: string
  impact: string
  count: number
}

export interface VarvisProjection {
  func: string | null
  consequence: string | null
  reason: 'empirical' | 'identity' | 'unmapped'
}

export const MIN_SUPPORT = 5
export const MIN_SHARE = 0.6

/** Ensembl VEP consequence severity order (most severe first). */
const VEP_ORDER = [
  'transcript_ablation',
  'splice_acceptor_variant',
  'splice_donor_variant',
  'stop_gained',
  'frameshift_variant',
  'stop_lost',
  'start_lost',
  'transcript_amplification',
  'feature_elongation',
  'feature_truncation',
  'inframe_insertion',
  'inframe_deletion',
  'missense_variant',
  'protein_altering_variant',
  'splice_donor_5th_base_variant',
  'splice_region_variant',
  'splice_donor_region_variant',
  'splice_polypyrimidine_tract_variant',
  'incomplete_terminal_codon_variant',
  'start_retained_variant',
  'stop_retained_variant',
  'synonymous_variant',
  'coding_sequence_variant',
  'mature_miRNA_variant',
  '5_prime_UTR_variant',
  '3_prime_UTR_variant',
  'non_coding_transcript_exon_variant',
  'intron_variant',
  'NMD_transcript_variant',
  'non_coding_transcript_variant',
  'coding_transcript_variant',
  'upstream_gene_variant',
  'downstream_gene_variant',
  'TFBS_ablation',
  'TFBS_amplification',
  'TF_binding_site_variant',
  'regulatory_region_ablation',
  'regulatory_region_amplification',
  'regulatory_region_variant',
  'intergenic_variant',
  'sequence_variant'
]
const RANK = new Map(VEP_ORDER.map((t, i) => [t, i]))

export function mostSevereOf(terms: string[]): string | null {
  let best: string | null = null
  for (const t of terms)
    if (best === null || (RANK.get(t) ?? 999) < (RANK.get(best) ?? 999)) best = t
  return best
}

/** The mapping key: picked-transcript terms, or the variant-level term when there is no transcript. */
export function vepTermKey(mostSevere: string, terms: string[]): string {
  return terms.length > 0 ? terms.join('&') : mostSevere
}

export function alleleClass(ref: string, alt: string): AlleleClass {
  let r = ref.toUpperCase()
  let a = alt.toUpperCase()
  while (r.length > 0 && a.length > 0 && r[r.length - 1] === a[a.length - 1]) {
    r = r.slice(0, -1)
    a = a.slice(0, -1)
  }
  while (r.length > 0 && a.length > 0 && r[0] === a[0]) {
    r = r.slice(1)
    a = a.slice(1)
  }
  if (r.length === 1 && a.length === 1) return 'snv'
  if (r.length === a.length) return 'mnv'
  if (r.length === 0) return 'ins'
  if (a.length === 0) return 'del'
  return 'delins'
}

/** Majority varvis func among rows, when support and share are sufficient. */
function majority(rows: FuncMappingRow[]): string | null {
  const byFunc = new Map<string, number>()
  for (const r of rows) byFunc.set(r.varvisFunc, (byFunc.get(r.varvisFunc) ?? 0) + r.count)
  const total = [...byFunc.values()].reduce((s, n) => s + n, 0)
  if (total < MIN_SUPPORT) return null
  const [func, n] = [...byFunc.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]
  return n / total >= MIN_SHARE ? func : null
}

export function impactFor(func: string, impactByFunc: ImpactRow[]): string | null {
  const rows = impactByFunc.filter((r) => r.varvisFunc === func).sort((a, b) => b.count - a.count)
  return rows[0]?.impact ?? null
}

export function projectToVarvis(
  vepMostSevere: string,
  terms: string[],
  mapping: FuncMappingRow[],
  impactByFunc: ImpactRow[],
  allele: { ref: string; alt: string }
): VarvisProjection {
  const cls = alleleClass(allele.ref, allele.alt)
  const key = vepTermKey(vepMostSevere, terms)
  const severe = mostSevereOf(terms) ?? vepMostSevere
  const bySevere = (r: FuncMappingRow): boolean => mostSevereOf(r.vepTerm.split('&')) === severe
  const own = mapping.filter((r) => r.alleleClass === cls)
  // Multi-base substitutions follow only their own empirical rows (varvis labels them `mnv`).
  const pooled = cls === 'mnv' ? [] : mapping.filter((r) => r.alleleClass !== 'mnv')
  const levels = [
    own.filter((r) => r.vepTerm === key),
    own.filter(bySevere),
    pooled.filter((r) => r.vepTerm === key),
    pooled.filter(bySevere)
  ]
  for (const rows of levels) {
    const func = majority(rows)
    if (func !== null)
      return { func, consequence: impactFor(func, impactByFunc), reason: 'empirical' }
  }
  if (cls !== 'mnv' && impactByFunc.some((r) => r.varvisFunc === severe))
    return { func: severe, consequence: impactFor(severe, impactByFunc), reason: 'identity' }
  return { func: null, consequence: null, reason: 'unmapped' }
}
