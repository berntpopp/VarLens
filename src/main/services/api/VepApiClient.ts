/**
 * VEP API client with rate limiting, caching, and request cancellation
 *
 * Fetches variant annotations from Ensembl VEP REST API with:
 * - Bottleneck rate limiting (15 req/sec, 55k req/hour)
 * - SQLite caching with 30-day TTL
 * - Request cancellation for rapid variant selection
 * - Zod response validation
 * - Exponential backoff retry on 429 (1s, 2s, 4s)
 */

import Bottleneck from 'bottleneck'
import { ApiCache } from './ApiCache'
import {
  VepResponseSchema,
  type VepResponse,
  type VepTranscriptConsequence
} from './schemas/vep-response'
import type { VepFetchResult } from '../../../shared/types/api-enrichment'
import { getSpliceAIMaxDelta } from './clinical-thresholds'
import { mainLogger } from '../MainLogger'
import { API_CONFIG } from '../../../shared/config'

/**
 * Normalize chromosome identifier for consistent cache keys
 * Removes 'chr' prefix and standardizes mitochondrial chromosome
 *
 * @example
 * normalizeChromosome('chr1') => '1'
 * normalizeChromosome('chrX') => 'X'
 * normalizeChromosome('chrM') => 'MT'
 * normalizeChromosome('mt') => 'MT'
 */
export function normalizeChromosome(chr: string): string {
  // Remove 'chr' prefix if present
  let normalized = chr.replace(/^chr/i, '')

  // Standardize mitochondrial chromosome to MT
  if (normalized.toLowerCase() === 'm' || normalized.toLowerCase() === 'mt') {
    normalized = 'MT'
  }

  return normalized
}

/**
 * Extracted prediction scores from VEP transcript
 * Used for UI display in side panel
 */
export interface ExtractedScores {
  cadd_phred?: number
  revel_score?: number
  spliceai_max_delta?: number
  sift_prediction?: string
  polyphen_prediction?: string
  gnomad_af?: number
}

export class VepApiClient {
  private cache: ApiCache
  private limiter: Bottleneck
  private abortController: AbortController | undefined
  private readonly baseUrl = 'https://rest.ensembl.org'

  constructor(cache: ApiCache) {
    this.cache = cache

    // Configure Bottleneck for VEP rate limits
    this.limiter = new Bottleneck({
      reservoir: API_CONFIG.VEP_HOURLY_LIMIT,
      reservoirRefreshAmount: API_CONFIG.VEP_HOURLY_LIMIT,
      reservoirRefreshInterval: 60 * 60 * 1000, // hourly refresh
      maxConcurrent: 1, // serialize requests for predictability
      minTime: API_CONFIG.VEP_MIN_TIME_MS
    })

    // Retry handling for 429 responses with exponential backoff
    this.limiter.on('failed', async (error, jobInfo) => {
      // Check if error has a message property containing '429'
      const errorMessage =
        error !== null &&
        error !== undefined &&
        typeof error === 'object' &&
        'message' in error &&
        typeof (error as { message: unknown }).message === 'string'
          ? (error as { message: string }).message
          : ''

      if (errorMessage.includes('429') && jobInfo.retryCount < 3) {
        // Exponential backoff: 1s, 2s, 4s
        const delay = Math.min(1000 * Math.pow(2, jobInfo.retryCount), 8000)
        // Add jitter: 50-100% of delay to spread retries
        return Math.floor(delay * (0.5 + Math.random() * 0.5))
      }
      return null // Don't retry for other errors
    })
  }

  /**
   * Fetch variant annotation from VEP API or cache
   *
   * @param chr - Chromosome (1-22, X, Y, MT, or chr-prefixed)
   * @param pos - Genomic position (1-based)
   * @param ref - Reference allele
   * @param alt - Alternate allele
   * @returns VepFetchResult with parsed data or error
   */
  async fetchVariantAnnotation(
    chr: string,
    pos: number,
    ref: string,
    alt: string
  ): Promise<VepFetchResult> {
    // Generate normalized cache key
    const normalizedChr = normalizeChromosome(chr)
    const cacheKey = `vep:${normalizedChr}:${pos}:${ref}:${alt}`

    // Check cache first
    const cached = this.cache.get(cacheKey)
    if (cached) {
      try {
        const data = VepResponseSchema.parse(JSON.parse(cached.data))
        return {
          success: true,
          data,
          cacheInfo: {
            cached: true,
            cachedAt: cached.createdAt
          },
          preferredTranscript: this.selectPreferredTranscript(data),
          allTranscripts: this.getAllTranscripts(data)
        }
      } catch (error) {
        // Cache entry corrupted, continue to fetch fresh data
        const message = error instanceof Error ? error.message : String(error)
        mainLogger.warn(`Corrupted cache entry for ${cacheKey}: ${message}`, 'api')
      }
    }

    // Cancel any pending request
    this.cancelPendingRequest()

    // Create new AbortController for this request
    this.abortController = new AbortController()
    const signal = this.abortController.signal

    try {
      // Schedule request with rate limiting
      const rawResponse = await this.limiter.schedule(() =>
        this.makeVepRequest(normalizedChr, pos, ref, alt, signal)
      )

      // Validate response with zod
      const data = VepResponseSchema.parse(rawResponse)

      // Cache response with 30-day TTL (actual 27-33 with jitter)
      this.cache.set(cacheKey, JSON.stringify(rawResponse), 30)

      return {
        success: true,
        data,
        cacheInfo: {
          cached: false,
          cachedAt: null
        },
        preferredTranscript: this.selectPreferredTranscript(data),
        allTranscripts: this.getAllTranscripts(data)
      }
    } catch (error) {
      // Re-throw AbortError to signal cancellation
      if (error instanceof Error && error.name === 'AbortError') {
        throw error
      }

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
          error: 'Invalid VEP response format',
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
   * Make HTTP request to VEP REST API
   *
   * @private
   * @throws Error on 429 (for retry handling)
   * @throws Error on non-OK response
   */
  private async makeVepRequest(
    chr: string,
    pos: number,
    _ref: string,
    alt: string,
    signal: AbortSignal
  ): Promise<unknown> {
    // Use GET endpoint for single variants (more reliable than POST)
    // URL format: /vep/human/region/{chr}:{start}:{end}/{allele}
    // Add parameters for prediction scores:
    // - CADD=1: Request CADD phred scores
    // - sift=b: Request SIFT prediction and score (b = both)
    // - polyphen=b: Request PolyPhen prediction and score (b = both)
    // Note: REVEL and SpliceAI are NOT available via REST API (require VEP plugins)
    const url = `${this.baseUrl}/vep/human/region/${chr}:${pos}:${pos}/${alt}?content-type=application/json&CADD=1&sift=b&polyphen=b&merged=1`

    const response = await fetch(url, {
      signal,
      headers: {
        'Content-Type': 'application/json'
      }
    })

    // Check for rate limit response
    if (response.status === 429) {
      const retryAfter = response.headers.get('Retry-After') ?? 'unknown'
      throw new Error(`429:${retryAfter}`)
    }

    // Check for other errors
    if (!response.ok) {
      throw new Error(`VEP API error: ${response.status}`)
    }

    return await response.json()
  }

  /**
   * Cancel any pending VEP request
   * Called when user selects a new variant before previous request completes
   */
  cancelPendingRequest(): void {
    if (this.abortController) {
      this.abortController.abort()
      this.abortController = undefined
    }
  }

  /**
   * Get cached VEP response by cache key
   * For IPC handler to check cache when offline
   *
   * @param cacheKey - Cache key (e.g., "vep:1:100:A:T")
   * @returns Parsed VepResponse and creation timestamp, or null if not cached
   */
  getCached(cacheKey: string): { data: VepResponse; createdAt: number } | null {
    const cached = this.cache.get(cacheKey)
    if (!cached) return null

    try {
      const data = VepResponseSchema.parse(JSON.parse(cached.data))
      return {
        data,
        createdAt: cached.createdAt
      }
    } catch (e) {
      mainLogger.warn(
        'Corrupted VEP cache entry for ' +
          cacheKey +
          ': ' +
          (e instanceof Error ? e.message : String(e)),
        'api'
      )
      return null
    }
  }

  /**
   * Select preferred transcript from VEP response
   * Prioritizes MANE Select, then canonical, then first transcript
   *
   * @param response - VEP response array
   * @returns Preferred transcript or null if no transcripts available
   */
  selectPreferredTranscript(response: VepResponse): VepTranscriptConsequence | null {
    const transcripts = response[0]?.transcript_consequences
    if (!transcripts || transcripts.length === 0) return null

    // Priority 1: MANE Select transcript (clinically preferred)
    const maneSelect = transcripts.find((tc) => tc.mane_select !== undefined)
    if (maneSelect !== undefined) return maneSelect

    // Priority 2: Canonical transcript
    const canonical = transcripts.find((tc) => tc.canonical === 1)
    if (canonical !== undefined) return canonical

    // Priority 3: First transcript
    return transcripts[0]
  }

  /**
   * Get all transcripts from VEP response
   * For UI dropdown to show all available transcripts
   *
   * @param response - VEP response array
   * @returns Array of all transcripts
   */
  getAllTranscripts(response: VepResponse): VepTranscriptConsequence[] {
    return response[0]?.transcript_consequences || []
  }

  /**
   * Extract prediction scores from transcript
   * Calculates SpliceAI max delta from 4 individual delta scores
   *
   * @param transcript - VEP transcript consequence
   * @returns Object with available scores (undefined for missing)
   */
  extractScores(transcript: VepTranscriptConsequence): ExtractedScores {
    // Calculate SpliceAI max delta from 4 individual delta scores
    const spliceai_max_delta = getSpliceAIMaxDelta(
      transcript.spliceai_pred_ds_ag,
      transcript.spliceai_pred_ds_al,
      transcript.spliceai_pred_ds_dg,
      transcript.spliceai_pred_ds_dl
    )

    return {
      cadd_phred: transcript.cadd_phred,
      revel_score: transcript.revel_score,
      spliceai_max_delta,
      sift_prediction: transcript.sift_prediction,
      polyphen_prediction: transcript.polyphen_prediction,
      gnomad_af: transcript.gnomad_af
    }
  }

  /**
   * Clear all cached VEP responses
   * For settings page "Clear VEP cache" button
   */
  clearCache(): void {
    this.cache.clearByPrefix('vep:')
  }
}
