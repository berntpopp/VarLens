/**
 * Full-value tooltip for ellipsis-truncated data-table cells (HGVS, transcript,
 * consequence, …) without any per-cell cost: the app-wide delegated tooltip
 * calls this on hover only, and it measures just the hovered cell.
 *
 * Screen readers already get the full value (CSS ellipsis is visual only); this
 * restores it for sighted mouse users at zoom/narrow widths.
 */

const CELL_SELECTOR = '.v-data-table td'

/** True when the element's content is wider than its box (i.e. clipped). */
function overflowsHorizontally(el: Element): boolean {
  return el instanceof HTMLElement && el.scrollWidth > el.clientWidth + 1
}

/** Collapsed text of a truncated table cell under `node`, or null. */
export function findTruncatedCellText(node: EventTarget | null): string | null {
  if (!(node instanceof Element)) return null
  const cell = node.closest<HTMLElement>(CELL_SELECTOR)
  if (!cell) return null
  const truncated = overflowsHorizontally(cell) || [...cell.children].some(overflowsDeep)
  if (!truncated) return null
  const text = (cell.textContent ?? '').replace(/\s+/g, ' ').trim()
  return text === '' ? null : text
}

function overflowsDeep(el: Element): boolean {
  return overflowsHorizontally(el) || [...el.children].some(overflowsDeep)
}
