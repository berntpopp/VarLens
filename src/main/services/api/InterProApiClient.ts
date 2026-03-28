/**
 * InterPro API client with rate limiting and caching
 *
 * Fetches protein domain annotations from the EBI InterPro REST API with:
 * - Bottleneck rate limiting (1000ms between requests, 1 concurrent)
 * - SQLite caching with 90-day TTL
 * - Zod response validation
 * - Domain type filtering (excludes family and homologous_superfamily)
 */

import Bottleneck from 'bottleneck'
import { ApiCache } from './ApiCache'
import { InterProResponseSchema } from './schemas/protein-response'
import type {
  ProteinDomain,
  ProteinDomainResult,
  ProteinApiError
} from '../../../shared/types/protein'
import { mainLogger } from '../MainLogger'

/** Domain entry types to include in results */
const INCLUDED_DOMAIN_TYPES = new Set([
  'domain',
  'region',
  'motif',
  'transmembrane',
  'signal',
  'repeat',
  'conserved_site'
])

export class InterProApiClient {
  private cache: ApiCache
  private limiter: Bottleneck
  private readonly baseUrl = 'https://www.ebi.ac.uk/interpro/api'

  constructor(cache: ApiCache) {
    this.cache = cache

    // Configure Bottleneck for InterPro rate limits
    this.limiter = new Bottleneck({
      maxConcurrent: 1,
      minTime: 1000 // 1000ms between requests
    })
  }

  /**
   * Fetch protein domains for a UniProt accession from InterPro or cache
   *
   * @param accession - UniProt accession (e.g., 'P04637')
   * @returns ProteinDomainResult with filtered domains or ProteinApiError
   */
  async fetchDomains(accession: string): Promise<ProteinDomainResult | ProteinApiError> {
    const normalizedAccession = accession.toUpperCase()
    const cacheKey = `interpro:${normalizedAccession}`

    // Check cache first
    const cached = this.cache.get(cacheKey)
    if (cached) {
      try {
        const raw = InterProResponseSchema.parse(JSON.parse(cached.data))
        const { domains, proteinLength } = this.extractDomains(raw.results, normalizedAccession)
        return {
          success: true,
          domains,
          proteinLength,
          cacheInfo: {
            cached: true,
            cachedAt: cached.createdAt
          }
        }
      } catch (error) {
        // Cache entry corrupted, continue to fetch fresh data
        const message = error instanceof Error ? error.message : String(error)
        mainLogger.warn(`Corrupted InterPro cache entry for ${cacheKey}: ${message}`, 'api')
      }
    }

    try {
      // Schedule request with rate limiting
      const rawResponse = await this.limiter.schedule(() =>
        this.makeInterProRequest(normalizedAccession)
      )

      // Validate response with Zod
      const parsed = InterProResponseSchema.parse(rawResponse)

      // Cache response with 90-day TTL
      this.cache.set(cacheKey, JSON.stringify(rawResponse), 90)

      const { domains, proteinLength } = this.extractDomains(parsed.results, normalizedAccession)

      return {
        success: true,
        domains,
        proteinLength,
        cacheInfo: {
          cached: false,
          cachedAt: undefined
        }
      }
    } catch (error) {
      // Handle Zod validation errors
      if (
        error !== null &&
        error !== undefined &&
        typeof error === 'object' &&
        'name' in error &&
        error.name === 'ZodError'
      ) {
        return {
          success: false,
          error: 'Invalid InterPro response format',
          offline: false
        }
      }

      // Handle other errors
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        offline: false
      }
    }
  }

  /**
   * Make HTTP GET request to InterPro REST API
   *
   * @private
   * @throws Error on non-OK response
   */
  private async makeInterProRequest(accession: string): Promise<unknown> {
    const url = `${this.baseUrl}/entry/interpro/protein/uniprot/${accession}`

    const response = await fetch(url, {
      headers: {
        Accept: 'application/json'
      }
    })

    if (!response.ok) {
      throw new Error(`InterPro API error: ${response.status}`)
    }

    return await response.json()
  }

  /**
   * Extract and filter domains from InterPro results
   *
   * Flattens entry_protein_locations into individual ProteinDomain objects,
   * skipping entries with types like 'family' and 'homologous_superfamily'.
   *
   * @private
   * @param results - Parsed InterPro result entries
   * @param accession - UniProt accession (normalized, for protein_length lookup)
   * @returns Filtered domains and protein length (0 if not determinable)
   */
  private extractDomains(
    results: ReturnType<typeof InterProResponseSchema.parse>['results'],
    accession: string
  ): { domains: ProteinDomain[]; proteinLength: number } {
    const domains: ProteinDomain[] = []
    let proteinLength = 0

    for (const entry of results) {
      const { accession: entryAccession, name, type } = entry.metadata

      // Skip entry types that are too broad for visualization
      if (!INCLUDED_DOMAIN_TYPES.has(type.toLowerCase())) {
        continue
      }

      if (!entry.proteins) continue

      for (const protein of entry.proteins) {
        // Capture protein length from any protein entry matching the accession
        if (
          proteinLength === 0 &&
          protein.accession.toUpperCase() === accession &&
          protein.protein_length !== undefined
        ) {
          proteinLength = protein.protein_length
        } else if (proteinLength === 0 && protein.protein_length !== undefined) {
          // Fall back to first available protein_length if accession doesn't match exactly
          proteinLength = protein.protein_length
        }

        if (!protein.entry_protein_locations) continue

        for (const location of protein.entry_protein_locations) {
          for (const fragment of location.fragments) {
            domains.push({
              accession: entryAccession,
              name,
              type: type.toLowerCase(),
              start: fragment.start,
              end: fragment.end
            })
          }
        }
      }
    }

    return { domains, proteinLength }
  }

  /**
   * Clear all cached InterPro responses
   */
  clearCache(): void {
    this.cache.clearByPrefix('interpro:')
  }
}
