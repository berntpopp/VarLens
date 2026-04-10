import type { ColumnDef } from './columns'

/**
 * Column definitions for CNV (copy number variant) variant tables.
 *
 * See svHeaders for the rationale — columns prefixed `_cnv_*` live on the
 * joined `variant_cnv` table and aren't in `SORTABLE_COLUMNS`, so they are
 * marked `sortable: false` to keep the UI honest.
 */
export const cnvHeaders: ColumnDef[] = [
  { title: '', key: 'annotations', sortable: false, width: '100px', align: 'center' },
  { title: 'Chr', key: 'chr', sortable: true },
  { title: 'Position', key: 'pos', sortable: true, align: 'end' },
  { title: 'End', key: 'end_pos', sortable: true, align: 'end' },
  { title: 'Type', key: 'sv_type', sortable: true },
  { title: 'Length', key: 'sv_length', sortable: true, align: 'end' },
  { title: 'Gene', key: 'gene_symbol', sortable: true },
  { title: 'Copy Number', key: '_cnv_copy_number', sortable: false, align: 'end' },
  { title: 'Hom Ref', key: '_cnv_ho_ref', sortable: false, align: 'end' },
  { title: 'Hom Alt', key: '_cnv_ho_alt', sortable: false, align: 'end' },
  { title: 'Consequence', key: 'consequence', sortable: true },
  { title: 'GT', key: 'gt_num', sortable: true },
  { title: 'CN Quality', key: '_cnv_gq', sortable: false, align: 'end' },
  { title: 'ClinVar', key: 'clinvar', sortable: true },
  { title: 'Filter', key: 'filter', sortable: true },
  { title: 'Caller', key: 'caller', sortable: true }
]
