/**
 * Composable for HPO term search using bundled JSON
 *
 * Provides lazy-loaded, client-side HPO term search from bundled JSON file.
 * The HPO JSON (~18k terms) is loaded on first search, not on app start.
 */

import { ref, computed } from 'vue'

/**
 * HPO term structure matching bundled JSON format
 */
export interface HpoTerm {
  /** HPO ID (e.g., "HP:0001250") */
  id: string
  /** HPO term name */
  name: string
}

// Lazy-loaded HPO terms cache
let hpoTermsCache: HpoTerm[] | null = null

// Loading state
const isLoading = ref(false)

// Error state
const loadError = ref<string | null>(null)

// Track if data has been loaded
const isLoaded = ref(false)

/**
 * Load HPO terms from bundled JSON (lazy, on first search)
 */
async function loadHpoTerms(): Promise<HpoTerm[]> {
  // Return cached if already loaded
  if (hpoTermsCache !== null) {
    return hpoTermsCache
  }

  // Prevent multiple concurrent loads
  if (isLoading.value) {
    // Wait for existing load to complete
    while (isLoading.value) {
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    return hpoTermsCache ?? []
  }

  isLoading.value = true
  loadError.value = null

  try {
    // Dynamic import for lazy loading (Vite will bundle this as a separate chunk)
    const module = await import('../assets/data/hpo-terms.json')
    hpoTermsCache = module.default as HpoTerm[]
    isLoaded.value = true
    return hpoTermsCache
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load HPO terms'
    loadError.value = message
    console.error('Failed to load bundled HPO terms:', error)
    return []
  } finally {
    isLoading.value = false
  }
}

export function useHpoBundled() {
  /**
   * Search HPO terms by query string
   *
   * Searches both ID and name fields. Returns up to maxResults matches.
   * Loads HPO data on first call (lazy loading).
   *
   * @param query - Search query (min 2 characters)
   * @param maxResults - Maximum number of results (default: 20)
   * @returns Array of matching HPO terms
   */
  async function search(query: string, maxResults: number = 20): Promise<HpoTerm[]> {
    // Require minimum query length
    if (!query || query.length < 2) {
      return []
    }

    // Load terms if not cached
    const terms = await loadHpoTerms()
    if (terms.length === 0) {
      return []
    }

    // Normalize query for case-insensitive search
    const normalizedQuery = query.toLowerCase().trim()

    // Search both ID and name
    const results: HpoTerm[] = []

    for (const term of terms) {
      // Check ID match (case-insensitive)
      if (term.id.toLowerCase().includes(normalizedQuery)) {
        results.push(term)
        if (results.length >= maxResults) break
        continue
      }

      // Check name match (case-insensitive)
      if (term.name.toLowerCase().includes(normalizedQuery)) {
        results.push(term)
        if (results.length >= maxResults) break
      }
    }

    // Sort results: exact ID matches first, then exact name matches, then partial matches
    results.sort((a, b) => {
      // Exact ID match has highest priority
      const aIdExact = a.id.toLowerCase() === normalizedQuery
      const bIdExact = b.id.toLowerCase() === normalizedQuery
      if (aIdExact && !bIdExact) return -1
      if (!aIdExact && bIdExact) return 1

      // ID starts with query has second priority
      const aIdStarts = a.id.toLowerCase().startsWith(normalizedQuery)
      const bIdStarts = b.id.toLowerCase().startsWith(normalizedQuery)
      if (aIdStarts && !bIdStarts) return -1
      if (!aIdStarts && bIdStarts) return 1

      // Exact name match has third priority
      const aNameExact = a.name.toLowerCase() === normalizedQuery
      const bNameExact = b.name.toLowerCase() === normalizedQuery
      if (aNameExact && !bNameExact) return -1
      if (!aNameExact && bNameExact) return 1

      // Name starts with query has fourth priority
      const aNameStarts = a.name.toLowerCase().startsWith(normalizedQuery)
      const bNameStarts = b.name.toLowerCase().startsWith(normalizedQuery)
      if (aNameStarts && !bNameStarts) return -1
      if (!aNameStarts && bNameStarts) return 1

      // Default: alphabetical by name
      return a.name.localeCompare(b.name)
    })

    return results
  }

  /**
   * Get a term by ID
   *
   * @param id - HPO ID
   * @returns HPO term or null if not found
   */
  async function getTermById(id: string): Promise<HpoTerm | null> {
    const terms = await loadHpoTerms()
    return terms.find((t) => t.id === id) ?? null
  }

  /**
   * Preload HPO terms (call early to avoid delay on first search)
   */
  async function preload(): Promise<void> {
    await loadHpoTerms()
  }

  /**
   * Get total number of terms
   */
  const termCount = computed(() => hpoTermsCache?.length ?? 0)

  return {
    search,
    getTermById,
    preload,
    isLoading,
    isLoaded,
    loadError,
    termCount
  }
}
