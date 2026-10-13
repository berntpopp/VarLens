export type PostgresVariantColumnKind = 'numeric' | 'categorical'

export interface PostgresVariantColumnDefinition {
  key: string
  sql: string
  kind: PostgresVariantColumnKind
}

export const POSTGRES_VARIANT_COLUMN_DEFINITIONS: Record<string, PostgresVariantColumnDefinition> =
  {
    chr: { key: 'chr', sql: 'v.chr', kind: 'categorical' },
    pos: { key: 'pos', sql: 'v.pos', kind: 'numeric' },
    gene_symbol: { key: 'gene_symbol', sql: 'v.gene_symbol', kind: 'categorical' },
    omim_mim_number: { key: 'omim_mim_number', sql: 'v.omim_mim_number', kind: 'categorical' },
    func: { key: 'func', sql: 'v.func', kind: 'categorical' },
    consequence: { key: 'consequence', sql: 'v.consequence', kind: 'categorical' },
    transcript: { key: 'transcript', sql: 'v.transcript', kind: 'categorical' },
    cdna: { key: 'cdna', sql: 'v.cdna', kind: 'categorical' },
    aa_change: { key: 'aa_change', sql: 'v.aa_change', kind: 'categorical' },
    gt_num: { key: 'gt_num', sql: 'v.gt_num', kind: 'categorical' },
    gnomad_af: { key: 'gnomad_af', sql: 'v.gnomad_af', kind: 'numeric' },
    cadd: { key: 'cadd', sql: 'v.cadd', kind: 'numeric' },
    qual: { key: 'qual', sql: 'v.qual', kind: 'numeric' },
    hpo_sim_score: { key: 'hpo_sim_score', sql: 'v.hpo_sim_score', kind: 'numeric' },
    clinvar: { key: 'clinvar', sql: 'v.clinvar', kind: 'categorical' },
    moi: { key: 'moi', sql: 'v.moi', kind: 'categorical' },
    hpo_match: { key: 'hpo_match', sql: 'v.hpo_match', kind: 'categorical' },
    variant_type: { key: 'variant_type', sql: 'v.variant_type', kind: 'categorical' },
    end_pos: { key: 'end_pos', sql: 'v.end_pos', kind: 'numeric' },
    sv_type: { key: 'sv_type', sql: 'v.sv_type', kind: 'categorical' },
    // Unsigned, as displayed (unsigned-columns.ts).
    sv_length: { key: 'sv_length', sql: 'ABS(v.sv_length)', kind: 'numeric' },
    caller: { key: 'caller', sql: 'v.caller', kind: 'categorical' },
    'sv.sv_is_precise': { key: 'sv.sv_is_precise', sql: 'sv.sv_is_precise', kind: 'categorical' },
    'sv.support': { key: 'sv.support', sql: 'sv.support', kind: 'numeric' },
    'sv.pe_support': { key: 'sv.pe_support', sql: 'sv.pe_support', kind: 'numeric' },
    'sv.sr_support': { key: 'sv.sr_support', sql: 'sv.sr_support', kind: 'numeric' },
    'sv.dr': { key: 'sv.dr', sql: 'sv.dr', kind: 'numeric' },
    'sv.dv': { key: 'sv.dv', sql: 'sv.dv', kind: 'numeric' },
    'sv.vaf': { key: 'sv.vaf', sql: 'sv.vaf', kind: 'numeric' },
    'sv.strand': { key: 'sv.strand', sql: 'sv.strand', kind: 'categorical' },
    'sv.coverage': { key: 'sv.coverage', sql: 'sv.coverage', kind: 'categorical' },
    'sv.cipos_left': { key: 'sv.cipos_left', sql: 'sv.cipos_left', kind: 'numeric' },
    'sv.cipos_right': { key: 'sv.cipos_right', sql: 'sv.cipos_right', kind: 'numeric' },
    'sv.ciend_left': { key: 'sv.ciend_left', sql: 'sv.ciend_left', kind: 'numeric' },
    'sv.ciend_right': { key: 'sv.ciend_right', sql: 'sv.ciend_right', kind: 'numeric' },
    'sv.stdev_len': { key: 'sv.stdev_len', sql: 'sv.stdev_len', kind: 'numeric' },
    'sv.stdev_pos': { key: 'sv.stdev_pos', sql: 'sv.stdev_pos', kind: 'numeric' },
    'sv.event_id': { key: 'sv.event_id', sql: 'sv.event_id', kind: 'categorical' },
    'sv.mate_id': { key: 'sv.mate_id', sql: 'sv.mate_id', kind: 'categorical' },
    'cnv.copy_number': { key: 'cnv.copy_number', sql: 'cnv.copy_number', kind: 'numeric' },
    'cnv.copy_number_quality': {
      key: 'cnv.copy_number_quality',
      sql: 'cnv.copy_number_quality',
      kind: 'numeric'
    },
    'cnv.homozygosity_ref': {
      key: 'cnv.homozygosity_ref',
      sql: 'cnv.homozygosity_ref',
      kind: 'numeric'
    },
    'cnv.homozygosity_alt': {
      key: 'cnv.homozygosity_alt',
      sql: 'cnv.homozygosity_alt',
      kind: 'numeric'
    },
    'cnv.sm': { key: 'cnv.sm', sql: 'cnv.sm', kind: 'numeric' },
    'cnv.bin_count': { key: 'cnv.bin_count', sql: 'cnv.bin_count', kind: 'numeric' },
    'str.repeat_id': { key: 'str.repeat_id', sql: 'str_ext.repeat_id', kind: 'categorical' },
    'str.variant_catalog_id': {
      key: 'str.variant_catalog_id',
      sql: 'str_ext.variant_catalog_id',
      kind: 'categorical'
    },
    'str.repeat_unit': {
      key: 'str.repeat_unit',
      sql: 'str_ext.repeat_unit',
      kind: 'categorical'
    },
    'str.display_repeat_unit': {
      key: 'str.display_repeat_unit',
      sql: 'str_ext.display_repeat_unit',
      kind: 'categorical'
    },
    'str.repeat_length': {
      key: 'str.repeat_length',
      sql: 'str_ext.repeat_length',
      kind: 'numeric'
    },
    'str.ref_copies': { key: 'str.ref_copies', sql: 'str_ext.ref_copies', kind: 'numeric' },
    'str.alt_copies': {
      key: 'str.alt_copies',
      sql: 'str_ext.alt_copies',
      kind: 'categorical'
    },
    'str.str_status': {
      key: 'str.str_status',
      sql: 'str_ext.str_status',
      kind: 'categorical'
    },
    'str.disease': { key: 'str.disease', sql: 'str_ext.disease', kind: 'categorical' },
    'str.inheritance_mode': {
      key: 'str.inheritance_mode',
      sql: 'str_ext.inheritance_mode',
      kind: 'categorical'
    },
    'str.source_display': {
      key: 'str.source_display',
      sql: 'str_ext.source_display',
      kind: 'categorical'
    },
    'str.support_type': {
      key: 'str.support_type',
      sql: 'str_ext.support_type',
      kind: 'categorical'
    },
    'str.normal_max': { key: 'str.normal_max', sql: 'str_ext.normal_max', kind: 'numeric' },
    'str.pathologic_min': {
      key: 'str.pathologic_min',
      sql: 'str_ext.pathologic_min',
      kind: 'numeric'
    },
    'str.locus_coverage': {
      key: 'str.locus_coverage',
      sql: 'str_ext.locus_coverage',
      kind: 'numeric'
    },
    'str.rank_score': {
      key: 'str.rank_score',
      sql: 'str_ext.rank_score',
      kind: 'categorical'
    },
    'str.confidence_interval': {
      key: 'str.confidence_interval',
      sql: 'str_ext.confidence_interval',
      kind: 'categorical'
    }
  }
