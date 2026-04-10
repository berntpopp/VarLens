import type { ColumnDef } from './columns'

/** Column definitions for STR (short tandem repeat) variant tables. */
export const strHeaders: ColumnDef[] = [
  { title: '', key: 'annotations', sortable: false, width: '100px', align: 'center' },
  { title: 'Locus', key: '_str_repeat_id', sortable: true },
  { title: 'Chr', key: 'chr', sortable: true },
  { title: 'Position', key: 'pos', sortable: true, align: 'end' },
  { title: 'Repeat Unit', key: '_str_repeat_unit', sortable: false },
  { title: 'Display RU', key: '_str_display_ru', sortable: false },
  { title: 'Ref Copies', key: '_str_ref_copies', sortable: true, align: 'end' },
  { title: 'Alt Copies', key: '_str_alt_copies', sortable: false },
  { title: 'Status', key: '_str_status', sortable: true },
  { title: 'Normal Max', key: '_str_normal_max', sortable: true, align: 'end' },
  { title: 'Pathologic Min', key: '_str_pathologic_min', sortable: true, align: 'end' },
  { title: 'Disease', key: '_str_disease', sortable: true },
  { title: 'Inheritance', key: '_str_inheritance_mode', sortable: true },
  { title: 'Rank Score', key: '_str_rank_score', sortable: false },
  { title: 'GT', key: 'gt_num', sortable: true },
  { title: 'Filter', key: 'filter', sortable: true }
]
