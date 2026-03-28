/**
 * AlphaFold Database API client with caching
 *
 * Fetches structure metadata for a UniProt accession from the AlphaFold DB with:
 * - SQLite caching with 90-day TTL
 * - Zod response validation
 * - 404 treated as valid "no prediction" result
 */

import { ApiCache } from './ApiCache'
import { AlphaFoldResponseSchema } from './schemas/protein-response'
import type { ProteinStructureResult, ProteinApiError } from '../../../shared/types/protein'
import { mainLogger } from '../MainLogger'

export class AlphaFoldApiClient {
  private cache: ApiCache
  private readonly baseUrl = 'https://alphafold.ebi.ac.uk'
  private readonly cacheTtlDays = 90

  constructor(cache: ApiCache) {
    this.cache = cache
  }

  /**
   * Fetch AlphaFold structure info for a UniProt accession
   *
   * @param uniprotAccession - UniProt accession (e.g., "P04637")
   * @returns ProteinStructureResult with structure sources or ProteinApiError
   */
  async fetchStructure(
    uniprotAccession: string
  ): Promise<ProteinStructureResult | ProteinApiError> {
    const cacheKey = `alphafold:${uniprotAccession}`

    // Check cache first
    const cached = this.cache.get(cacheKey)
    if (cached) {
      try {
        const raw = AlphaFoldResponseSchema.parse(JSON.parse(cached.data))
        return {
          success: true,
          structure: this.buildStructureInfo(uniprotAccession, raw),
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
      const { status, data } = await this.makeAlphaFoldRequest(uniprotAccession)

      // 404 means no prediction exists — valid result
      if (status === 404) {
        // Cache the empty array so subsequent calls skip the network
        this.cache.set(cacheKey, JSON.stringify([]), this.cacheTtlDays)
        return {
          success: true,
          structure: {
            uniprotAccession,
            alphafold: null,
            pdb: null
          },
          cacheInfo: {
            cached: false
          }
        }
      }

      const parsed = AlphaFoldResponseSchema.parse(data)

      this.cache.set(cacheKey, JSON.stringify(data), this.cacheTtlDays)

      return {
        success: true,
        structure: this.buildStructureInfo(uniprotAccession, parsed),
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
          error: 'Invalid AlphaFold response format',
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
   * Make HTTP request to AlphaFold DB API
   *
   * @private
   * @returns status code and parsed JSON body (or null for 404)
   * @throws Error on non-OK, non-404 response or network failure
   */
  private async makeAlphaFoldRequest(
    uniprotAccession: string
  ): Promise<{ status: number; data: unknown }> {
    const url = `${this.baseUrl}/api/prediction/${uniprotAccession}`

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'VarLens/1.0 (Electron desktop app)'
      }
    })

    if (response.status === 404) {
      return { status: 404, data: null }
    }

    if (!response.ok) {
      throw new Error(`AlphaFold API error: ${response.status}`)
    }

    return { status: response.status, data: await response.json() }
  }

  /**
   * Build ProteinStructureInfo from a validated AlphaFold response array
   *
   * @private
   */
  private buildStructureInfo(
    uniprotAccession: string,
    predictions: ReturnType<typeof AlphaFoldResponseSchema.parse>
  ) {
    const prediction = predictions[0]

    if (prediction === undefined) {
      return { uniprotAccession, alphafold: null, pdb: null }
    }

    // Extract entry ID (e.g., "AF-P04637-F1" → "AF-P04637-F1")
    const id = prediction.entryId

    // Prefer CIF format; fall back to pdbUrl
    const cifUrl = prediction.cifUrl ?? prediction.modelUrl
    const pdbUrl = prediction.pdbUrl

    return {
      uniprotAccession,
      alphafold:
        cifUrl !== undefined && cifUrl !== ''
          ? {
              source: 'alphafold' as const,
              url: cifUrl,
              format: 'cif' as const,
              id,
              version: prediction.latestVersion
            }
          : null,
      pdb:
        pdbUrl !== undefined && pdbUrl !== ''
          ? {
              source: 'pdb' as const,
              url: pdbUrl,
              format: 'pdb' as const,
              id
            }
          : null
    }
  }

  /**
   * Clear all cached AlphaFold responses
   */
  clearCache(): void {
    this.cache.clearByPrefix('alphafold:')
  }
}
