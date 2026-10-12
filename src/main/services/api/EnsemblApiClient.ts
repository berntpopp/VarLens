/**
 * Ensembl REST API client for gene structure (exon) data
 *
 * Fetches the gene (no expand) and then only its canonical transcript with
 * exons: `?expand=1` on the gene returns every transcript with its exons
 * (TTN: 818 KB, 15–21 s), which ran into the timeout.
 * - Bottleneck rate limiting (500ms between requests, max 2 concurrent)
 * - One retry with backoff on a timeout, 5xx or 429 (API_CONFIG.ENSEMBL_*)
 * - SQLite caching with 90-day TTL
 * - Zod response validation
 */

import Bottleneck from 'bottleneck'
import { ApiCache } from './ApiCache'
import { EnsemblGeneLookupSchema, EnsemblTranscriptLookupSchema } from './schemas/protein-response'
import type { GeneStructureResult, ProteinApiError } from '../../../shared/types/protein'
import { mainLogger } from '../MainLogger'
import { API_CONFIG } from '../../../shared/config'
import { apiFixturePath, readApiFixture } from './ApiFixtureLoader'

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

export class EnsemblApiClient {
  private cache: ApiCache | null
  private limiter: Bottleneck
  private readonly baseUrl = 'https://rest.ensembl.org'
  private readonly cacheTtlDays = 90

  constructor(cache: ApiCache | null) {
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

    const fixture = readApiFixture(
      apiFixturePath(['ensembl', `${geneSymbol.toLowerCase()}-gene-structure.json`])
    )
    if (fixture !== null) {
      const raw = EnsemblGeneLookupSchema.parse(fixture)
      const result = this.parseGeneStructure(raw, geneSymbol)
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
    }

    // Check cache first
    const cached = this.cache?.get(cacheKey)
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
      this.cache?.set(cacheKey, JSON.stringify(rawResponse), this.cacheTtlDays)

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
   * The gene (small, no expand) plus its canonical transcript with exons,
   * combined into the gene-lookup shape the parser and the cache use.
   */
  private async makeRequest(geneSymbol: string): Promise<unknown> {
    const gene = EnsemblGeneLookupSchema.parse(
      await this.getJson(`/lookup/symbol/homo_sapiens/${encodeURIComponent(geneSymbol)}`)
    )
    const canonical = gene.canonical_transcript?.split('.')[0]
    if (canonical === undefined || canonical === '') return gene
    const transcript = EnsemblTranscriptLookupSchema.parse(
      await this.getJson(`/lookup/id/${encodeURIComponent(canonical)}?expand=1`)
    )
    return { ...gene, Transcript: [{ ...transcript, is_canonical: 1 }] }
  }

  /** GET with the Ensembl timeout; one retry (after a backoff) on a timeout, 5xx or 429. */
  private async getJson(path: string): Promise<unknown> {
    const url = `${this.baseUrl}${path}${path.includes('?') ? '&' : '?'}content-type=application/json`
    const attempts = API_CONFIG.ENSEMBL_RETRIES + 1
    let lastError: Error = new Error('Ensembl API error')
    for (let attempt = 1; attempt <= attempts; attempt++) {
      if (attempt > 1) await sleep(API_CONFIG.ENSEMBL_RETRY_BACKOFF_MS * (attempt - 1))
      try {
        const response = await fetch(url, {
          signal: AbortSignal.timeout(API_CONFIG.ENSEMBL_TIMEOUT_MS),
          headers: { 'Content-Type': 'application/json' }
        })
        if (response.ok) return await response.json()
        lastError = new Error(`Ensembl API error: ${response.status}`)
        // 4xx (except 429) will not change on a retry.
        if (response.status < 500 && response.status !== 429) throw lastError
      } catch (error) {
        if (error === lastError) throw error
        const timedOut = error instanceof Error && error.name === 'TimeoutError'
        if (!timedOut) throw error
        lastError = new Error(
          `Ensembl did not answer within ${API_CONFIG.ENSEMBL_TIMEOUT_MS / 1000} s (${attempts} attempts)`
        )
      }
      mainLogger.warn(`Ensembl ${path}: ${lastError.message} (attempt ${attempt})`, 'ensembl')
    }
    throw lastError
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
    this.cache?.clearByPrefix('ensembl:')
  }
}
