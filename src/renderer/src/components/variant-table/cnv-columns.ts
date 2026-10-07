import type { ColumnDef } from './columns'

/**
 * Column definitions for CNV (copy number variant) variant tables.
 *
 * All 4 extension columns (`variant_cnv` joined) are sortable per the Task 1
 * registry. They use dotted keys (`cnv.copy_number`, etc.) so Vuetify's
 * sort-by event routes through the backend's `resolveSortColumn` extension
 * sort path. The `value` getter reads the stable SELECT projection alias
 * (`_cnv_copy_number` etc.) from `VariantFilterBuilder`, since Vuetify 3
 * would otherwise interpret a dotted key as a nested path accessor.
 */
export const cnvHeaders: ColumnDef[] = [
  { title: '', key: 'annotations', sortable: false, width: '100px', align: 'center' },
  { title: 'Chr', key: 'chr', sortable: true },
  { title: 'Position', key: 'pos', sortable: true, align: 'end' },
  { title: 'End', key: 'end_pos', sortable: true, align: 'end' },
  { title: 'Type', key: 'sv_type', sortable: true },
  { title: 'Length', key: 'sv_length', sortable: true, align: 'end' },
  { title: 'Gene', key: 'gene_symbol', sortable: true },
  {
    title: 'Copy Number',
    key: 'cnv.copy_number',
    sortable: true,
    align: 'end',
    value: (item) => (item as { _cnv_copy_number?: number | null })._cnv_copy_number ?? null
  },
  {
    title: 'Hom Ref',
    key: 'cnv.homozygosity_ref',
    sortable: true,
    align: 'end',
    value: (item) => (item as { _cnv_ho_ref?: number | null })._cnv_ho_ref ?? null
  },
  {
    title: 'Hom Alt',
    key: 'cnv.homozygosity_alt',
    sortable: true,
    align: 'end',
    value: (item) => (item as { _cnv_ho_alt?: number | null })._cnv_ho_alt ?? null
  },
  { title: 'Impact', key: 'consequence', sortable: true },
  { title: 'GT', key: 'gt_num', sortable: true },
  {
    title: 'CN Quality',
    key: 'cnv.copy_number_quality',
    sortable: true,
    align: 'end',
    value: (item) => (item as { _cnv_gq?: number | null })._cnv_gq ?? null
  },
  { title: 'ClinVar', key: 'clinvar', sortable: true },
  { title: 'Filter', key: 'filter', sortable: true },
  { title: 'Caller', key: 'caller', sortable: true }
]
