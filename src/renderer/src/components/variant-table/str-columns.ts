import type { ColumnDef } from './columns'

/**
 * Column definitions for STR (short tandem repeat) variant tables.
 *
 * See svHeaders for the rationale — columns prefixed `_str_*` live on the
 * joined `variant_str` table and aren't in `SORTABLE_COLUMNS`, so they are
 * marked `sortable: false` to keep the UI honest.
 */
export const strHeaders: ColumnDef[] = [
  { title: '', key: 'annotations', sortable: false, width: '100px', align: 'center' },
  { title: 'Locus', key: '_str_repeat_id', sortable: false },
  { title: 'Chr', key: 'chr', sortable: true },
  { title: 'Position', key: 'pos', sortable: true, align: 'end' },
  { title: 'Repeat Unit', key: '_str_repeat_unit', sortable: false },
  { title: 'Display RU', key: '_str_display_ru', sortable: false },
  { title: 'Ref Copies', key: '_str_ref_copies', sortable: false, align: 'end' },
  { title: 'Alt Copies', key: '_str_alt_copies', sortable: false },
  { title: 'Status', key: '_str_status', sortable: false },
  { title: 'Normal Max', key: '_str_normal_max', sortable: false, align: 'end' },
  { title: 'Pathologic Min', key: '_str_pathologic_min', sortable: false, align: 'end' },
  { title: 'Disease', key: '_str_disease', sortable: false },
  { title: 'Inheritance', key: '_str_inheritance_mode', sortable: false },
  { title: 'Rank Score', key: '_str_rank_score', sortable: false },
  { title: 'GT', key: 'gt_num', sortable: true },
  { title: 'Filter', key: 'filter', sortable: true }
]
