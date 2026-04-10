import type { ColumnDef } from './columns'

/**
 * Column definitions for SV (structural variant) variant tables.
 *
 * NOTE: Extension-table columns prefixed `_sv_*` live on the joined
 * `variant_sv` table and are deliberately marked `sortable: false` because
 * `VariantFilterBuilder.SORTABLE_COLUMNS` only contains columns from the
 * `variants` table itself. Extending sort support to joined-table columns
 * requires a dedicated sort path (future work) — attempting to sort on
 * them today would silently fall back to default ordering.
 */
export const svHeaders: ColumnDef[] = [
  { title: '', key: 'annotations', sortable: false, width: '100px', align: 'center' },
  { title: 'Chr', key: 'chr', sortable: true },
  { title: 'Position', key: 'pos', sortable: true, align: 'end' },
  { title: 'End', key: 'end_pos', sortable: true, align: 'end' },
  { title: 'SV Type', key: 'sv_type', sortable: true },
  { title: 'Length', key: 'sv_length', sortable: true, align: 'end' },
  { title: 'Gene', key: 'gene_symbol', sortable: true },
  { title: 'Consequence', key: 'consequence', sortable: true },
  { title: 'Support', key: '_sv_support', sortable: false, align: 'end' },
  { title: 'DR/DV', key: '_sv_dr_dv', sortable: false, align: 'end' },
  { title: 'VAF', key: '_sv_vaf', sortable: false, align: 'end' },
  { title: 'Precise', key: '_sv_is_precise', sortable: false, align: 'center' },
  { title: 'GT', key: 'gt_num', sortable: true },
  { title: 'QUAL', key: 'qual', sortable: true, align: 'end' },
  { title: 'Filter', key: 'filter', sortable: true },
  { title: 'ClinVar', key: 'clinvar', sortable: true },
  { title: 'Caller', key: 'caller', sortable: true }
]
