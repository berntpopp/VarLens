/**
 * Shared test helper for creating variant objects with defaults.
 */
export function makeVariant(overrides: Record<string, unknown> = {}) {
  return {
    chr: '1',
    pos: 100,
    ref: 'A',
    alt: 'G',
    gene_symbol: 'BRCA1',
    consequence: 'missense_variant',
    gnomad_af: null,
    cadd: null,
    clinvar: null,
    gt_num: '0/1',
    func: null,
    qual: null,
    hpo_sim_score: null,
    transcript: null,
    cdna: null,
    aa_change: null,
    moi: null,
    omim_mim_number: null,
    ...overrides
  }
}
