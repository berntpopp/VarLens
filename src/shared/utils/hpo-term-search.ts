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
  /** Exact and related synonyms from the HPO ontology. */
  synonyms?: readonly string[]
}

export interface HpoSearchHit extends HpoTermEntry {
  /** Winning synonym when a synonym tier ranked higher than the primary label. */
  matchedSynonym?: string
}

export const HPO_MIN_QUERY_LENGTH = 2
export const HPO_DEFAULT_MAX_RESULTS = 20

interface IndexedHpoTerm {
  term: HpoTermEntry
  id: string
  name: string
  synonyms: readonly string[]
  rawSynonyms: readonly string[]
}

const indexCache = new WeakMap<readonly HpoTermEntry[], readonly IndexedHpoTerm[]>()
const collator = new Intl.Collator('en')

function getIndexedTerms(terms: readonly HpoTermEntry[]): readonly IndexedHpoTerm[] {
  let cached = indexCache.get(terms)
  if (cached === undefined) {
    cached = terms.map((term) => {
      const rawSynonyms = term.synonyms ?? []
      return {
        term,
        id: term.id.toLowerCase(),
        name: term.name.toLowerCase(),
        synonyms: rawSynonyms.map((s) => s.toLowerCase()),
        rawSynonyms
      }
    })
    indexCache.set(terms, cached)
  }
  return cached
}

function matchTerm(entry: IndexedHpoTerm, q: string): { tier: number; hit: HpoSearchHit } | null {
  const { term, id, name, synonyms, rawSynonyms } = entry
  const base: HpoSearchHit = { id: term.id, name: term.name }
  if (id === q) return { tier: 0, hit: base }
  if (id.startsWith(q)) return { tier: 1, hit: base }
  if (name === q) return { tier: 2, hit: base }

  let prefixSynonym: string | undefined
  let substringSynonym: string | undefined
  for (let i = 0; i < synonyms.length; i++) {
    const low = synonyms[i]
    const syn = rawSynonyms[i]
    if (low === q) return { tier: 3, hit: { ...base, matchedSynonym: syn } }
    if (prefixSynonym === undefined && low.startsWith(q)) prefixSynonym = syn
    else if (substringSynonym === undefined && low.includes(q)) substringSynonym = syn
  }

  if (name.startsWith(q)) return { tier: 4, hit: base }
  if (prefixSynonym !== undefined) {
    return { tier: 5, hit: { ...base, matchedSynonym: prefixSynonym } }
  }
  if (id.includes(q) || name.includes(q)) return { tier: 6, hit: base }
  if (substringSynonym !== undefined) {
    return { tier: 7, hit: { ...base, matchedSynonym: substringSynonym } }
  }
  return null
}

/**
 * Case-insensitive substring search over ID, label, and synonyms. Results are
 * ordered by match tier (0..7) and then alphabetical by primary label.
 * Queries shorter than {@link HPO_MIN_QUERY_LENGTH} return no results.
 */
export function searchHpoTerms(
  terms: readonly HpoTermEntry[],
  query: string,
  maxResults: number = HPO_DEFAULT_MAX_RESULTS
): HpoSearchHit[] {
  const normalized = query.toLowerCase().trim()
  if (normalized.length < HPO_MIN_QUERY_LENGTH || maxResults <= 0) return []

  const indexed = getIndexedTerms(terms)
  const results: Array<{ tier: number; hit: HpoSearchHit }> = []
  for (const entry of indexed) {
    const matched = matchTerm(entry, normalized)
    if (matched !== null) results.push(matched)
  }

  // Rank every match before capping: the best one may come late in the list.
  return results
    .sort((a, b) => {
      const diff = a.tier - b.tier
      return diff !== 0 ? diff : collator.compare(a.hit.name, b.hit.name)
    })
    .slice(0, maxResults)
    .map((r) => r.hit)
}
