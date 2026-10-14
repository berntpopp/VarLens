import type { ColumnDef } from './columns'

/**
 * Column definitions for STR (short tandem repeat) variant tables.
 *
 * Sortable extension columns (locus, repeat unit, counts, clinical fields)
 * use dotted keys per the Task 1 registry so Vuetify's sort-by event routes
 * through the backend's `resolveSortColumn` extension sort path. Each has a
 * `value` getter reading the stable SELECT alias (`_str_*`) since Vuetify 3
 * would otherwise interpret a dotted key as a nested path accessor.
 *
 * `Alt Copies` stays non-sortable (biallelic "10/12" text), and `Rank Score`
 * stays non-sortable (text despite the name) per the Task 1 registry
 * decision on compound TEXT values.
 */
export const strHeaders: ColumnDef[] = [
  { title: '', key: 'annotations', sortable: false, width: '100px', align: 'center' },
  {
    title: 'Locus',
    key: 'str.repeat_id',
    sortable: true,
    value: (item) => (item as { _str_repeat_id?: string | null })._str_repeat_id ?? null
  },
  { title: 'Chr', key: 'chr', sortable: true },
  { title: 'Position', key: 'pos', sortable: true, align: 'end' },
  {
    title: 'Repeat Unit',
    key: 'str.repeat_unit',
    sortable: true,
    value: (item) => (item as { _str_repeat_unit?: string | null })._str_repeat_unit ?? null
  },
  {
    title: 'Display RU',
    key: 'str.display_repeat_unit',
    sortable: true,
    value: (item) => (item as { _str_display_ru?: string | null })._str_display_ru ?? null
  },
  {
    title: 'Ref Copies',
    key: 'str.ref_copies',
    sortable: true,
    align: 'end',
    value: (item) => (item as { _str_ref_copies?: number | null })._str_ref_copies ?? null
  },
  { title: 'Alt Copies', key: '_str_alt_copies', sortable: false },
  {
    title: 'Status',
    key: 'str.str_status',
    sortable: true,
    value: (item) =>
      (item as { _str_status?: string | null })._str_status?.replace(/_/g, ' ') ?? null
  },
  {
    title: 'Normal Max',
    key: 'str.normal_max',
    sortable: true,
    align: 'end',
    value: (item) => (item as { _str_normal_max?: number | null })._str_normal_max ?? null
  },
  {
    title: 'Pathologic Min',
    key: 'str.pathologic_min',
    sortable: true,
    align: 'end',
    value: (item) => (item as { _str_pathologic_min?: number | null })._str_pathologic_min ?? null
  },
  {
    title: 'Disease',
    key: 'str.disease',
    sortable: true,
    value: (item) => (item as { _str_disease?: string | null })._str_disease ?? null
  },
  {
    title: 'Inheritance',
    key: 'str.inheritance_mode',
    sortable: true,
    value: (item) =>
      (item as { _str_inheritance_mode?: string | null })._str_inheritance_mode ?? null
  },
  { title: 'Rank Score', key: '_str_rank_score', sortable: false },
  { title: 'GT', key: 'gt_num', sortable: true },
  { title: 'Filter', key: 'filter', sortable: true }
]
