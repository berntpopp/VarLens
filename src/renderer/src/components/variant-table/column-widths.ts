/**
 * Fixed column widths shared by the case variant table and the cohort table.
 *
 * Both tables use `table-layout: fixed` (data-table-shared.css) so columns
 * never resize while rows are swapped during loading (the audit measured up
 * to 134 px of horizontal header jitter per page change). Every rendered
 * column therefore needs an explicit width.
 *
 * Widths are in rem so they grow with the user's text size: at 200 % text a
 * header still fits its label, sort icon and filter button instead of
 * clipping to "C…". Each width covers the header at 100 % text:
 * label (0.8125rem bold) + sort icon + filter button + 12 px cell padding
 * on each side, i.e. roughly `label + 76 px`, and the typical cell value.
 * The px-sized parts of the header (padding, filter button) do not grow
 * with text, so a width that fits at 100 % also fits at 200 %.
 *
 * Keep this the single source of truth for both views (cohort parity).
 */
import type { ColumnDef } from './columns'
import { LINKS_COLUMN_KEY } from '../../utils/link-outs'

/**
 * Width of the leading annotations column (rem); the sticky 2nd column
 * offsets by it (`left: 6.75rem` in data-table-shared.css).
 */
export const ANNOTATIONS_COLUMN_WIDTH_REM = 6.75

export const COLUMN_WIDTHS_REM: Readonly<Record<string, number>> = {
  'data-table-expand': 2.5,
  annotations: ANNOTATIONS_COLUMN_WIDTH_REM,
  chr: 6.25,
  pos: 8,
  ref: 5,
  alt: 5,
  gt_num: 6,
  gene_symbol: 7,
  omim_mim_number: 7.25,
  func: 12.5,
  consequence: 10.125,
  transcript: 10,
  cdna: 12.5,
  aa_change: 10.625,
  gnomad_af: 9.5,
  cadd: 7.25,
  cadd_phred: 7.25,
  qual: 6.75,
  clinvar: 10.5,
  hpo_sim_score: 9,
  moi: 6.25,
  carrier_count: 8,
  cohort_frequency: 9.25,
  het_count: 8.5
}

/** Fallback for extension columns (SV/CNV/STR), which have short labels. */
export const DEFAULT_COLUMN_WIDTH_REM = 8.75

export function columnWidthRem(key: string): number {
  return COLUMN_WIDTHS_REM[key] ?? DEFAULT_COLUMN_WIDTH_REM
}

/**
 * Return the column with its shared fixed width applied. The Links column
 * keeps the width it was built with: it depends on how many links exist.
 */
export function withFixedWidth<T extends Pick<ColumnDef, 'key' | 'width'>>(column: T): T {
  if (column.key === LINKS_COLUMN_KEY && column.width !== undefined) return column
  return { ...column, width: `${columnWidthRem(column.key)}rem` }
}
