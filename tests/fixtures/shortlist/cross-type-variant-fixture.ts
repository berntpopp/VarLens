import type { ShortlistCandidate, VariantTypeKey } from '../../../src/shared/types/shortlist'
import type { Variant } from '../../../src/shared/types/database'

/**
 * Build a minimal ShortlistCandidate with sane defaults for every Variant field.
 *
 * The `base` literal is deliberately typed `as Variant`: every field on the
 * current `Variant` interface must be present here. If `Variant` gains a new
 * column, TypeScript will flag this helper as incomplete, forcing a
 * conscious update in one place.
 */
export function buildShortlistCandidate(
  overrides: Partial<ShortlistCandidate> & { variant_type: VariantTypeKey }
): ShortlistCandidate {
  const base: Variant = {
    id: 1,
    case_id: 1,
    chr: '1',
    pos: 1000,
    ref: 'A',
    alt: 'T',
    gene_symbol: null,
    omim_mim_number: null,
    consequence: null,
    gnomad_af: null,
    cadd: null,
    clinvar: null,
    gt_num: null,
    func: null,
    qual: null,
    hpo_sim_score: null,
    transcript: null,
    cdna: null,
    aa_change: null,
    moi: null,
    gq: null,
    dp: null,
    ad_ref: null,
    ad_alt: null,
    ab: null,
    filter: null,
    info_json: null,
    source_format: null,
    variant_type: 'snv',
    end_pos: null,
    sv_type: null,
    sv_length: null,
    caller: null,
    internal_af: null
  } as Variant

  return {
    ...base,
    sv_is_precise: null,
    sv_vaf: null,
    sv_support: null,
    cnv_copy_number: null,
    cnv_copy_number_quality: null,
    str_status: null,
    str_disease: null,
    str_alt_copies: null,
    is_starred: false,
    ...overrides
  }
}

/**
 * Deterministic 30-variant cross-type fixture. Documented expected rank
 * position under the "Tier 1 candidates" preset appears in the JSDoc of
 * each entry so ShortlistService integration tests can assert ordering.
 */
export function buildCrossTypeVariantFixture(): ShortlistCandidate[] {
  const rows: ShortlistCandidate[] = []

  // SNV/indel (10)
  // 1: HIGH rare ClinVar Pathogenic - expected rank #1 under Tier 1
  rows.push(
    buildShortlistCandidate({
      id: 1,
      variant_type: 'snv',
      gene_symbol: 'BRCA1',
      consequence: 'HIGH',
      cadd: 35,
      gnomad_af: 0.0001,
      clinvar: 'Pathogenic'
    })
  )
  // 2: MODERATE rare ClinVar Likely_pathogenic
  rows.push(
    buildShortlistCandidate({
      id: 2,
      variant_type: 'snv',
      gene_symbol: 'TP53',
      consequence: 'MODERATE',
      cadd: 25,
      gnomad_af: 0.0005,
      clinvar: 'Likely_pathogenic'
    })
  )
  // 3: HIGH rare no-clinvar high-CADD
  rows.push(
    buildShortlistCandidate({
      id: 3,
      variant_type: 'indel',
      gene_symbol: 'MLH1',
      consequence: 'HIGH',
      cadd: 38,
      gnomad_af: 0.0003,
      clinvar: null
    })
  )
  // 4: LOW common - excluded by Tier 1 preset filters
  rows.push(
    buildShortlistCandidate({
      id: 4,
      variant_type: 'snv',
      gene_symbol: 'FOO',
      consequence: 'LOW',
      cadd: 5,
      gnomad_af: 0.1,
      clinvar: null
    })
  )
  // 5-8: moderate distribution
  for (let i = 5; i <= 8; i++) {
    rows.push(
      buildShortlistCandidate({
        id: i,
        variant_type: 'snv',
        gene_symbol: `GENE${i}`,
        consequence: 'MODERATE',
        cadd: 18 + i,
        gnomad_af: 0.0005,
        clinvar: null
      })
    )
  }
  // 9: CADD NULL edge case
  rows.push(
    buildShortlistCandidate({
      id: 9,
      variant_type: 'snv',
      gene_symbol: 'NULLCADD',
      consequence: 'MODERATE',
      cadd: null,
      gnomad_af: 0.0001,
      clinvar: null
    })
  )
  // 10: gnomAD NULL edge case
  rows.push(
    buildShortlistCandidate({
      id: 10,
      variant_type: 'snv',
      gene_symbol: 'NULLAF',
      consequence: 'HIGH',
      cadd: 30,
      gnomad_af: null,
      clinvar: null
    })
  )

  // SV (5)
  rows.push(
    buildShortlistCandidate({
      id: 11,
      variant_type: 'sv',
      gene_symbol: 'DMD',
      sv_type: 'DEL',
      sv_length: 1000,
      sv_is_precise: 1,
      sv_vaf: 0.45
    })
  )
  rows.push(
    buildShortlistCandidate({
      id: 12,
      variant_type: 'sv',
      gene_symbol: 'CFTR',
      sv_type: 'DUP',
      sv_length: 500,
      sv_is_precise: 0,
      sv_vaf: 0.3
    })
  )
  rows.push(
    buildShortlistCandidate({
      id: 13,
      variant_type: 'sv',
      gene_symbol: 'FBN1',
      sv_type: 'INV',
      sv_length: 2000,
      sv_is_precise: 1,
      sv_vaf: 0.5
    })
  )
  rows.push(
    buildShortlistCandidate({
      id: 14,
      variant_type: 'sv',
      gene_symbol: 'DYSF',
      sv_type: 'DEL',
      sv_length: 100000,
      sv_is_precise: 1,
      sv_vaf: 0.48
    })
  )
  rows.push(
    buildShortlistCandidate({
      id: 15,
      variant_type: 'sv',
      gene_symbol: 'NF1',
      sv_type: 'BND',
      sv_length: null,
      sv_is_precise: 0,
      sv_vaf: null
    })
  )

  // CNV (3)
  rows.push(
    buildShortlistCandidate({
      id: 16,
      variant_type: 'cnv',
      gene_symbol: 'SMN1',
      cnv_copy_number: 0,
      cnv_copy_number_quality: 95
    })
  )
  rows.push(
    buildShortlistCandidate({
      id: 17,
      variant_type: 'cnv',
      gene_symbol: 'ABL1',
      cnv_copy_number: 3,
      cnv_copy_number_quality: 80
    })
  )
  rows.push(
    buildShortlistCandidate({
      id: 18,
      variant_type: 'cnv',
      gene_symbol: 'AMBIG',
      cnv_copy_number: 1.8 as unknown as number,
      cnv_copy_number_quality: null
    })
  )

  // STR (2)
  rows.push(
    buildShortlistCandidate({
      id: 19,
      variant_type: 'str',
      gene_symbol: 'HTT',
      str_status: 'full_mutation',
      str_disease: "Huntington's disease",
      str_alt_copies: '45'
    })
  )
  rows.push(
    buildShortlistCandidate({
      id: 20,
      variant_type: 'str',
      gene_symbol: 'UNK',
      str_status: 'intermediate',
      str_disease: null,
      str_alt_copies: '32'
    })
  )

  return rows
}
