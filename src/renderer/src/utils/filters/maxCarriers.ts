/**
 * Carrier cap ("seen in at most N cases", #455): the one place that decides
 * when the cap is on and how it reads. Shared by the case and the cohort view.
 */

/** The cap when it is on: a whole number of cases, at least 1. Anything else is off. */
export function activeMaxCarriers(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1
    ? Math.min(value, 1_000_000)
    : null
}

/** Text typed into the field as a cap. Empty, not a number or below 1 turns it off. */
export function parseMaxCarriers(raw: string | number | null | undefined): number | null {
  const typed = typeof raw === 'number' ? raw : Number.parseFloat(raw ?? '')
  return Number.isFinite(typed) && typed >= 1 ? Math.min(Math.floor(typed), 1_000_000) : null
}

/** Chip and summary text, for example "≤ 3 cases". */
export function maxCarriersLabel(cap: number): string {
  return `≤ ${cap} ${cap === 1 ? 'case' : 'cases'}`
}
