/**
 * Ensembl REST API client for gene structure (exon) data
 *
 * Fetches gene info with transcripts and exon coordinates using:
 * - Bottleneck rate limiting (500ms between requests, max 2 concurrent)
 * - SQLite caching with 90-day TTL
 * - Zod response validation
 */

import Bottleneck from 'bottleneck'
import { ApiCache } from './ApiCache'
import { EnsemblGeneLookupSchema } from './schemas/protein-response'
import type { GeneStructureResult, ProteinApiError } from '../../../shared/types/protein'
import { mainLogger } from '../MainLogger'

export class EnsemblApiClient {
  private cache: ApiCache
  private limiter: Bottleneck
  private readonly baseUrl = 'https://rest.ensembl.org'
  private readonly cacheTtlDays = 90

  constructor(cache: ApiCache) {
    this.cache = cache

    this.limiter = new Bottleneck({
      maxConcurrent: 2,
      minTime: 500
    })
  }

  /**
   * Fetch gene structure (exon coordinates) for a gene symbol
   *
   * Uses Ensembl lookup endpoint with expand=1 to get transcripts and exons.
   * Selects the canonical transcript (or first available).
   *
   * @param geneSymbol - HGNC gene symbol (e.g., "BRCA1")
   * @returns GeneStructureResult with exon data or ProteinApiError
   */
  async fetchGeneStructure(geneSymbol: string): Promise<GeneStructureResult | ProteinApiError> {
    const cacheKey = `ensembl:gene:${geneSymbol}`

    // Check cache first
    const cached = this.cache.get(cacheKey)
    if (cached) {
      try {
        const raw = EnsemblGeneLookupSchema.parse(JSON.parse(cached.data))
        const result = this.parseGeneStructure(raw, geneSymbol)
        if (result !== null) {
          return {
            ...result,
            cacheInfo: { cached: true, cachedAt: cached.createdAt }
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        mainLogger.warn(`Corrupted Ensembl cache for ${cacheKey}: ${message}`, 'ensembl')
      }
    }

    try {
      const rawResponse = await this.limiter.schedule(() => this.makeRequest(geneSymbol))

      // Validate with Zod
      const data = EnsemblGeneLookupSchema.parse(rawResponse)

      // Cache the raw response
      this.cache.set(cacheKey, JSON.stringify(rawResponse), this.cacheTtlDays)

      const result = this.parseGeneStructure(data, geneSymbol)
      if (result === null) {
        return {
          success: false,
          error: `No transcript with exon data found for gene: ${geneSymbol}`
        }
      }

      return {
        ...result,
        cacheInfo: { cached: false }
      }
    } catch (error) {
      if (
        error !== null &&
        error !== undefined &&
        typeof error === 'object' &&
        'name' in error &&
        error.name === 'ZodError'
      ) {
        return {
          success: false,
          error: 'Invalid Ensembl response format'
        }
      }

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  /**
   * Make HTTP request to Ensembl lookup API
   */
  private async makeRequest(geneSymbol: string): Promise<unknown> {
    const url = `${this.baseUrl}/lookup/symbol/homo_sapiens/${encodeURIComponent(geneSymbol)}?expand=1&content-type=application/json`

    const response = await fetch(url, {
      headers: { 'Content-Type': 'application/json' }
    })

    if (response.status === 429) {
      const retryAfter = response.headers.get('Retry-After') ?? 'unknown'
      throw new Error(`429:${retryAfter}`)
    }

    if (!response.ok) {
      throw new Error(`Ensembl API error: ${response.status}`)
    }

    return await response.json()
  }

  /**
   * Parse Ensembl gene lookup response into GeneStructure
   * Selects canonical transcript, or first transcript with exon data
   */
  private parseGeneStructure(
    data: ReturnType<typeof EnsemblGeneLookupSchema.parse>,
    geneSymbol: string
  ): Omit<GeneStructureResult, 'cacheInfo'> | null {
    const transcripts = data.Transcript
    if (!transcripts || transcripts.length === 0) return null

    // Prefer canonical transcript, fall back to first with exons
    const canonical = transcripts.find(
      (t) => t.is_canonical === 1 && t.Exon !== undefined && t.Exon.length > 0
    )
    const withExons = transcripts.find((t) => t.Exon !== undefined && t.Exon.length > 0)
    const selected = canonical ?? withExons

    if (!selected || !selected.Exon || selected.Exon.length === 0) return null

    return {
      success: true,
      geneStructure: {
        geneSymbol,
        chromosome: data.seq_region_name,
        start: data.start,
        end: data.end,
        strand: data.strand === -1 ? -1 : 1,
        transcriptId: selected.display_name ?? selected.id,
        exons: selected.Exon.map((e) => ({ start: e.start, end: e.end }))
          .sort((a, b) => a.start - b.start)
          .map((e, i) => ({
            start: e.start,
            end: e.end,
            rank: data.strand === -1 ? selected.Exon!.length - i : i + 1
          }))
      }
    }
  }

  /**
   * Clear all cached Ensembl responses
   */
  clearCache(): void {
    this.cache.clearByPrefix('ensembl:')
  }
}
