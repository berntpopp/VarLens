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

/** How many distinct strings an import result carries at most. */
const REPORTED = 50

/**
 * The distinct ClinVar strings this import could not rank (at most
 * {@link REPORTED}), or undefined when all were ranked. Call once, when the
 * import is done: it goes into the import result, so the import summary can
 * show it, and into the log through {@link unrankedClinvarLogLine}.
 */
export function takeUnrankedClinvar(): string[] | undefined {
  const strings = takeUnrankedClinvarStrings()
  return strings.length === 0 ? undefined : strings.slice(0, REPORTED)
}

/** The log line for an import with unranked ClinVar strings. */
export function unrankedClinvarLogLine(importName: string, strings: readonly string[]): string {
  const shown = strings.slice(0, SHOWN).map((value) => JSON.stringify(value))
  const more = strings.length > SHOWN ? ` and ${strings.length - SHOWN} more` : ''
  return (
    `Import "${importName}": ${strings.length} ClinVar significance value(s) are not in the ` +
    `severity configuration and rank as unknown: ${shown.join(', ')}${more}`
  )
}

/**
 * The unrecognised ClinVar values of several files as one list: each value
 * once, in first-seen order; undefined when there are none.
 */
export function mergeUnrankedClinvar(
  lists: ReadonlyArray<readonly string[] | undefined>
): string[] | undefined {
  const merged = [...new Set(lists.flatMap((list) => list ?? []))]
  return merged.length === 0 ? undefined : merged
}
