/**
 * Fixed column widths shared by the case variant table and the cohort table.
 *
 * Both tables use `table-layout: fixed` (data-table-shared.css) so columns
 * never resize while rows are swapped during loading (the audit measured up
 * to 134 px of horizontal header jitter per page change). Every rendered
 * column therefore needs an explicit width; sizes were measured from the
 * header content (label + sort + filter affordances) and typical cell values.
 *
 * Keep this the single source of truth for both views (cohort parity).
 */
import type { ColumnDef } from './columns'
import { LINKS_COLUMN_KEY } from '../../utils/link-outs'

/** Width of the leading annotations column; the sticky 2nd column offsets by it. */
export const ANNOTATIONS_COLUMN_WIDTH = 108

export const COLUMN_WIDTHS: Readonly<Record<string, number>> = {
  'data-table-expand': 40,
  annotations: ANNOTATIONS_COLUMN_WIDTH,
  chr: 92,
  pos: 140,
  ref: 80,
  alt: 80,
  gt_num: 100,
  gene_symbol: 120,
  omim_mim_number: 104,
  func: 200,
  consequence: 152,
  transcript: 160,
  cdna: 200,
  aa_change: 170,
  gnomad_af: 142,
  cadd: 106,
  cadd_phred: 106,
  qual: 96,
  clinvar: 182,
  hpo_sim_score: 136,
  moi: 90,
  carrier_count: 118,
  cohort_frequency: 142,
  het_count: 128
}

export const DEFAULT_COLUMN_WIDTH = 140

export function columnWidthPx(key: string): number {
  return COLUMN_WIDTHS[key] ?? DEFAULT_COLUMN_WIDTH
}

/**
 * Return the column with its shared fixed width applied. The Links column
 * keeps the width it was built with: it depends on how many links exist.
 */
export function withFixedWidth<T extends Pick<ColumnDef, 'key' | 'width'>>(column: T): T {
  if (column.key === LINKS_COLUMN_KEY && column.width !== undefined) return column
  return { ...column, width: `${columnWidthPx(column.key)}px` }
}
