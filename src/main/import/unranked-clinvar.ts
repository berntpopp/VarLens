/**
 * What an import says about ClinVar strings it could not rank (#469).
 *
 * The severity configuration maps raw significance strings to categories. A
 * spelling it does not know gets rank 0 ("unknown"), which is correct but
 * invisible: the variant then never represents a cohort row by its ClinVar
 * value. Every import reports the distinct unranked strings once, so they can
 * be added to src/shared/config/severity.config.ts.
 */
import { takeUnrankedClinvarStrings } from '../../shared/config/severity.config'

const SHOWN = 20

/** Forget strings collected before this import (another import, a backfill). */
export function resetUnrankedClinvar(): void {
  takeUnrankedClinvarStrings()
}

/** The log line for this import, or null when every ClinVar string was ranked. */
export function unrankedClinvarMessage(importName: string): string | null {
  const strings = takeUnrankedClinvarStrings()
  if (strings.length === 0) return null
  const shown = strings.slice(0, SHOWN).map((value) => JSON.stringify(value))
  const more = strings.length > SHOWN ? ` and ${strings.length - SHOWN} more` : ''
  return (
    `Import "${importName}": ${strings.length} ClinVar significance value(s) are not in the ` +
    `severity configuration and rank as unknown: ${shown.join(', ')}${more}`
  )
}
