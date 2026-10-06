/**
 * Case-view variant-type tab helpers (pure; no Vue imports).
 */
import type { PerTypeTab, VisibleTab } from '../../../shared/types/shortlist'

/**
 * Single display-row descriptor used by `v-tabs`. `count` is `null` for
 * the synthetic Shortlist tab (it has no single row count) and a number
 * for every real per-type tab. `icon` is optional; only Shortlist uses
 * it today.
 */
export interface TabItem {
  type: VisibleTab
  label: string
  count: number | null
  icon?: string
}

/**
 * Returns the per-type tabs that should be shown for this case, in the
 * canonical display order (snv → sv → cnv → str). Folds `indel` into
 * `snv` because the UI presents them as a single "SNV/Indel" tab.
 *
 * Shared between `tabItems` (display) and `loadTypeCounts`
 * (default-selection) because SNV/indel folding is domain logic, not a
 * display-layer concern — keeping a single helper prevents the two
 * consumers from drifting.
 */
export function getPresentTabTypes(counts: Record<string, number>): PerTypeTab[] {
  const present: PerTypeTab[] = []
  if ((counts.snv ?? 0) + (counts.indel ?? 0) > 0) present.push('snv')
  if ((counts.sv ?? 0) > 0) present.push('sv')
  if ((counts.cnv ?? 0) > 0) present.push('cnv')
  if ((counts.str ?? 0) > 0) present.push('str')
  return present
}
