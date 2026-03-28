/**
 * UniProt API client with rate limiting and caching
 *
 * Maps gene symbols to UniProt accessions using the UniProt REST API with:
 * - Bottleneck rate limiting (500ms between requests, max 2 concurrent)
 * - SQLite caching with 90-day TTL
 * - Zod response validation
 */

import Bottleneck from 'bottleneck'
import { ApiCache } from './ApiCache'
import { UniProtResponseSchema } from './schemas/protein-response'
import type { ProteinMappingResult, ProteinApiError } from '../../../shared/types/protein'
import { mainLogger } from '../MainLogger'

export class UniProtApiClient {
  private cache: ApiCache
  private limiter: Bottleneck
  private readonly baseUrl = 'https://rest.uniprot.org'
  private readonly cacheTtlDays = 90

  constructor(cache: ApiCache) {
    this.cache = cache

    this.limiter = new Bottleneck({
      maxConcurrent: 2,
      minTime: 500
    })
  }

  /**
   * Fetch UniProt mapping for a gene symbol
   *
   * @param geneSymbol - HGNC gene symbol (e.g., "BRCA1")
   * @returns ProteinMappingResult with UniProt data or ProteinApiError
   */
  async fetchProteinMapping(geneSymbol: string): Promise<ProteinMappingResult | ProteinApiError> {
    const cacheKey = `uniprot:${geneSymbol}`

    // Check cache first
    const cached = this.cache.get(cacheKey)
    if (cached) {
      try {
        const raw = UniProtResponseSchema.parse(JSON.parse(cached.data))
        const result = raw.results[0]
        if (result === undefined) {
          return { success: false, error: `No UniProt entry found for gene: ${geneSymbol}` }
        }
        return {
          success: true,
          mapping: {
            uniprotAccession: result.primaryAccession,
            geneName: result.genes?.[0]?.geneName?.value ?? geneSymbol,
            proteinName: result.proteinDescription?.recommendedName?.fullName?.value ?? '',
            proteinLength: result.sequence.length
          },
          cacheInfo: {
            cached: true,
            cachedAt: cached.createdAt
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        mainLogger.warn(`Corrupted cache entry for ${cacheKey}: ${message}`, 'api')
      }
    }

    try {
      const rawResponse = await this.limiter.schedule(() => this.makeUniProtRequest(geneSymbol))

      const data = UniProtResponseSchema.parse(rawResponse)

      if (data.results.length === 0) {
        return {
          success: false,
          error: `No UniProt entry found for gene: ${geneSymbol}`
        }
      }

      // Cache the raw response
      this.cache.set(cacheKey, JSON.stringify(rawResponse), this.cacheTtlDays)

      const result = data.results[0]
      return {
        success: true,
        mapping: {
          uniprotAccession: result.primaryAccession,
          geneName: result.genes?.[0]?.geneName?.value ?? geneSymbol,
          proteinName: result.proteinDescription?.recommendedName?.fullName?.value ?? '',
          proteinLength: result.sequence.length
        },
        cacheInfo: {
          cached: false
        }
      }
    } catch (error) {
      // Handle validation errors
      if (
        error !== null &&
        error !== undefined &&
        typeof error === 'object' &&
        'name' in error &&
        error.name === 'ZodError'
      ) {
        return {
          success: false,
          error: 'Invalid UniProt response format',
          offline: false
        }
      }

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        offline: false
      }
    }
  }

  /**
   * Make HTTP request to UniProt REST API
   *
   * @private
   * @throws Error on non-OK response or network failure
   */
  private async makeUniProtRequest(geneSymbol: string): Promise<unknown> {
    const query = `gene_exact:${encodeURIComponent(geneSymbol)}+AND+organism_id:9606+AND+reviewed:true`
    const fields = 'accession,gene_names,protein_name,length'
    const url = `${this.baseUrl}/uniprotkb/search?query=${query}&fields=${fields}&format=json&size=1`

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'VarLens/1.0 (Electron desktop app)'
      }
    })

    if (!response.ok) {
      throw new Error(`UniProt API error: ${response.status}`)
    }

    return await response.json()
  }

  /**
   * Clear all cached UniProt responses
   */
  clearCache(): void {
    this.cache.clearByPrefix('uniprot:')
  }
}
