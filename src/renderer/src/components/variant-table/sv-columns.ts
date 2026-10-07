import type { ColumnDef } from './columns'

/**
 * Column definitions for SV (structural variant) variant tables.
 *
 * Scalar extension columns (`sv.support`, `sv.vaf`, `sv.sv_is_precise`) are
 * sortable per the Task 1 registry and use dotted keys so Vuetify's sort-by
 * event routes through the backend's `resolveSortColumn` extension sort
 * path. Each has a `value` getter reading the stable SELECT alias
 * (`_sv_support` etc.) since Vuetify 3 would otherwise interpret a dotted
 * key as a nested path accessor.
 *
 * `DR/DV` remains non-sortable because it's a composite display concat of
 * two registry columns (`sv.dr` + `sv.dv`) — no single sort target exists.
 */
export const svHeaders: ColumnDef[] = [
  { title: '', key: 'annotations', sortable: false, width: '100px', align: 'center' },
  { title: 'Chr', key: 'chr', sortable: true },
  { title: 'Position', key: 'pos', sortable: true, align: 'end' },
  { title: 'End', key: 'end_pos', sortable: true, align: 'end' },
  { title: 'SV Type', key: 'sv_type', sortable: true },
  { title: 'Length', key: 'sv_length', sortable: true, align: 'end' },
  { title: 'Gene', key: 'gene_symbol', sortable: true },
  { title: 'Impact', key: 'consequence', sortable: true },
  {
    title: 'Support',
    key: 'sv.support',
    sortable: true,
    align: 'end',
    value: (item) => (item as { _sv_support?: number | null })._sv_support ?? null
  },
  { title: 'DR/DV', key: '_sv_dr_dv', sortable: false, align: 'end' },
  {
    title: 'VAF',
    key: 'sv.vaf',
    sortable: true,
    align: 'end',
    value: (item) => (item as { _sv_vaf?: number | null })._sv_vaf ?? null
  },
  {
    title: 'Precise',
    key: 'sv.sv_is_precise',
    sortable: true,
    align: 'center',
    value: (item) => (item as { _sv_is_precise?: number | null })._sv_is_precise ?? null
  },
  { title: 'GT', key: 'gt_num', sortable: true },
  { title: 'QUAL', key: 'qual', sortable: true, align: 'end' },
  { title: 'Filter', key: 'filter', sortable: true },
  { title: 'ClinVar', key: 'clinvar', sortable: true },
  { title: 'Caller', key: 'caller', sortable: true }
]
