/**
 * Offline HPO term search over the bundled ontology term list
 * (`src/renderer/src/assets/data/hpo-terms.json`, ~18k `{ id, name }` rows).
 *
 * One implementation for both runtimes: the renderer's `useHpoBundled`
 * composable searches the lazily imported JSON in the browser/Electron, and
 * the web server serves `hpo:search` from the same file without any network
 * egress (src/web/server/web-hpo-terms.ts).
 */

export interface HpoTermEntry {
  /** HPO ID (e.g. "HP:0001250"). */
  id: string
  /** Term label. */
  name: string
}

export const HPO_MIN_QUERY_LENGTH = 2
export const HPO_DEFAULT_MAX_RESULTS = 20

function rank(term: HpoTermEntry, query: string): number {
  const id = term.id.toLowerCase()
  const name = term.name.toLowerCase()
  if (id === query) return 0
  if (id.startsWith(query)) return 1
  if (name === query) return 2
  if (name.startsWith(query)) return 3
  return 4
}

/**
 * Case-insensitive substring search over ID and label. Results are ordered:
 * exact ID, ID prefix, exact label, label prefix, then alphabetical by label.
 * Queries shorter than {@link HPO_MIN_QUERY_LENGTH} return no results.
 */
export function searchHpoTerms(
  terms: readonly HpoTermEntry[],
  query: string,
  maxResults: number = HPO_DEFAULT_MAX_RESULTS
): HpoTermEntry[] {
  const normalized = query.toLowerCase().trim()
  if (normalized.length < HPO_MIN_QUERY_LENGTH || maxResults <= 0) return []

  const results: HpoTermEntry[] = []
  for (const term of terms) {
    if (
      term.id.toLowerCase().includes(normalized) ||
      term.name.toLowerCase().includes(normalized)
    ) {
      results.push(term)
      if (results.length >= maxResults) break
    }
  }

  return results.sort((a, b) => {
    const diff = rank(a, normalized) - rank(b, normalized)
    return diff !== 0 ? diff : a.name.localeCompare(b.name)
  })
}
