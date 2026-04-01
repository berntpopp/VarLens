/**
 * HPO (Human Phenotype Ontology) API client
 *
 * Provides autocomplete search for HPO terms via NLM Clinical Tables API.
 * Implements caching to reduce API calls and improve offline availability.
 *
 * Reference: https://clinicaltables.nlm.nih.gov/apidoc/hpo/v3/doc.html
 */

import type { ApiCache } from './ApiCache'
import { mainLogger } from '../MainLogger'
import type { HpoTerm } from './schemas/hpo-response'
import type { HpoSearchResult } from '../../../shared/types/api-enrichment'
import { HpoAutocompleteResponseSchema } from './schemas/hpo-response'

export class HpoApiClient {
  private readonly baseUrl = 'https://clinicaltables.nlm.nih.gov/api/hpo/v3/search'
  private readonly cache: ApiCache
  private lastRequestTime = 0
  private readonly minDelay = 200 // 5 req/sec courtesy rate limit

  constructor(cache: ApiCache) {
    this.cache = cache
  }

  /**
   * Search HPO terms matching query
   * Searches by name, ID, and synonyms (API handles automatically)
   *
   * @param query - Search query (min 2 characters)
   * @param maxResults - Maximum results to return (default 20)
   * @returns HpoSearchResult with success/failure status
   */
  async search(query: string, maxResults: number = 20): Promise<HpoSearchResult> {
    try {
      // Require minimum 2 characters per CONTEXT.md
      if (query.length < 2) {
        return {
          success: true,
          terms: []
        }
      }

      // Generate cache key
      const cacheKey = `hpo:search:${query.toLowerCase().trim()}:${maxResults}`

      // Check cache first - HPO terms don't change often, cache for 30 days
      const cached = this.cache.get(cacheKey)
      if (cached) {
        const parsed = JSON.parse(cached.data) as HpoTerm[]
        return {
          success: true,
          terms: parsed
        }
      }

      // Apply courtesy delay to avoid overwhelming NLM API
      const now = Date.now()
      const timeSinceLastRequest = now - this.lastRequestTime
      if (timeSinceLastRequest < this.minDelay) {
        await new Promise((resolve) => setTimeout(resolve, this.minDelay - timeSinceLastRequest))
      }
      this.lastRequestTime = Date.now()

      // Build request URL
      const params = new URLSearchParams({
        terms: query,
        count: maxResults.toString(),
        df: 'id,name' // Display fields: ID and name only
      })

      const url = `${this.baseUrl}?${params.toString()}`

      // Fetch with timeout (NLM can be slow)
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 10000) // 10s timeout

      const response = await fetch(url, {
        signal: controller.signal
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        throw new Error(`HPO API returned status ${response.status}`)
      }

      const data = await response.json()

      // Validate response structure with Zod
      const validated = HpoAutocompleteResponseSchema.parse(data)

      // Transform tuple format to HpoTerm array
      // API returns: [total_count, id_array, null, [[id, name], [id, name], ...]]
      const terms: HpoTerm[] = validated[3].map(([id, name]) => ({ id, name }))

      // Cache transformed result
      this.cache.set(cacheKey, JSON.stringify(terms), 30)

      return {
        success: true,
        terms
      }
    } catch (error) {
      // Return error result
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        offline: false
      }
    }
  }

  /**
   * Get cached search results for offline access
   * Returns null if query not previously searched
   *
   * @param query - Search query
   * @param maxResults - Maximum results requested
   * @returns Cached terms or null
   */
  getCached(query: string, maxResults: number): HpoTerm[] | null {
    if (query.length < 2) {
      return []
    }

    const cacheKey = `hpo:search:${query.toLowerCase().trim()}:${maxResults}`
    const cached = this.cache.get(cacheKey)

    if (!cached) return null

    try {
      return JSON.parse(cached.data) as HpoTerm[]
    } catch (e) {
      mainLogger.warn(
        'Corrupted HPO cache entry: ' + (e instanceof Error ? e.message : String(e)),
        'api'
      )
      return null
    }
  }

  /**
   * Clear all cached HPO responses
   */
  clearCache(): void {
    this.cache.clearByPrefix('hpo:')
  }
}
