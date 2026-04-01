/**
 * SpliceAI Lookup API client (Broad Institute)
 *
 * Fetches SpliceAI delta scores from Broad Institute's public API with:
 * - SQLite caching with 30-day TTL
 * - Zod response validation
 * - Rate limiting (courtesy)
 *
 * Reference: https://spliceailookup.broadinstitute.org/
 */

import Bottleneck from 'bottleneck'
import { z } from 'zod'
import { ApiCache } from './ApiCache'
import { mainLogger } from '../MainLogger'

/**
 * Zod schema for SpliceAI Lookup API response
 */
const SpliceAIScoreSchema = z.object({
  DS_AG: z.string(), // Delta Score Acceptor Gain
  DS_AL: z.string(), // Delta Score Acceptor Loss
  DS_DG: z.string(), // Delta Score Donor Gain
  DS_DL: z.string(), // Delta Score Donor Loss
  DP_AG: z.number().optional(), // Delta Position Acceptor Gain
  DP_AL: z.number().optional(), // Delta Position Acceptor Loss
  DP_DG: z.number().optional(), // Delta Position Donor Gain
  DP_DL: z.number().optional(), // Delta Position Donor Loss
  g_name: z.string().optional(), // Gene name
  t_id: z.string().optional(), // Transcript ID
  t_priority: z.string().optional() // Transcript priority (MS = MANE Select)
})

const SpliceAIResponseSchema = z.object({
  variant: z.string(),
  chrom: z.string(),
  pos: z.number(),
  ref: z.string(),
  alt: z.string(),
  scores: z.array(SpliceAIScoreSchema).optional(),
  error: z.string().optional()
})

export type SpliceAIResponse = z.infer<typeof SpliceAIResponseSchema>
export type SpliceAIScore = z.infer<typeof SpliceAIScoreSchema>

/**
 * Extracted SpliceAI scores
 */
export interface SpliceAIScores {
  /** Maximum delta score across all 4 types */
  max_delta: number
  /** Acceptor Gain delta score */
  ds_ag: number
  /** Acceptor Loss delta score */
  ds_al: number
  /** Donor Gain delta score */
  ds_dg: number
  /** Donor Loss delta score */
  ds_dl: number
  /** Gene name */
  gene: string | null
  /** Transcript ID */
  transcript: string | null
}

export interface SpliceAIFetchResult {
  success: true
  scores: SpliceAIScores
  cacheInfo: {
    cached: boolean
    cachedAt: number | null
  }
}

export interface SpliceAIFetchError {
  success: false
  error: string
  offline: boolean
}

export type SpliceAIResult = SpliceAIFetchResult | SpliceAIFetchError

export class SpliceAIApiClient {
  private cache: ApiCache
  private limiter: Bottleneck
  // Broad Institute's public SpliceAI API on Google Cloud Run
  private readonly baseUrl38 = 'https://spliceai-38-xwkwwwxdwq-uc.a.run.app'
  private readonly baseUrl37 = 'https://spliceai-37-xwkwwwxdwq-uc.a.run.app'

  constructor(cache: ApiCache) {
    this.cache = cache

    // Courtesy rate limiting - 5 req/sec
    this.limiter = new Bottleneck({
      maxConcurrent: 1,
      minTime: 200 // 200ms between requests = 5 req/sec
    })
  }

  /**
   * Fetch SpliceAI scores for a variant
   *
   * @param chr - Chromosome (1-22, X, Y, MT)
   * @param pos - Genomic position (1-based)
   * @param ref - Reference allele
   * @param alt - Alternate allele
   * @param assembly - Genome assembly (38 or 37)
   */
  async fetchSpliceAIScores(
    chr: string,
    pos: number,
    ref: string,
    alt: string,
    assembly: '38' | '37' = '38'
  ): Promise<SpliceAIResult> {
    // Normalize chromosome (remove chr prefix)
    const normalizedChr = chr.replace(/^chr/i, '')

    // Format: 17-43092919-G-A
    const variantId = `${normalizedChr}-${pos}-${ref}-${alt}`
    const cacheKey = `spliceai:${assembly}:${variantId}`

    // Check cache first
    const cached = this.cache.get(cacheKey)
    if (cached) {
      try {
        const data = SpliceAIResponseSchema.parse(JSON.parse(cached.data))
        const scores = this.extractScores(data)
        if (scores) {
          return {
            success: true,
            scores,
            cacheInfo: {
              cached: true,
              cachedAt: cached.createdAt
            }
          }
        }
      } catch (e) {
        mainLogger.warn(
          `Corrupted SpliceAI cache entry for ${cacheKey}: ` +
            (e instanceof Error ? e.message : String(e)),
          'api'
        )
      }
    }

    try {
      const rawResponse = await this.limiter.schedule(() => this.makeRequest(variantId, assembly))

      const data = SpliceAIResponseSchema.parse(rawResponse)

      // Check for API error
      if (data.error !== undefined && data.error !== '') {
        return {
          success: false,
          error: data.error,
          offline: false
        }
      }

      // Extract scores
      const scores = this.extractScores(data)
      if (!scores) {
        return {
          success: false,
          error: 'No SpliceAI scores available for this variant',
          offline: false
        }
      }

      // Cache response
      this.cache.set(cacheKey, JSON.stringify(rawResponse), 30)

      return {
        success: true,
        scores,
        cacheInfo: {
          cached: false,
          cachedAt: null
        }
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        offline: false
      }
    }
  }

  private async makeRequest(variantId: string, assembly: string): Promise<unknown> {
    const baseUrl = assembly === '38' ? this.baseUrl38 : this.baseUrl37

    // API parameters:
    // - hg: genome version (38 or 37)
    // - bc: basic or comprehensive gencode
    // - distance: max distance to look for splice sites (default 500)
    // - mask: mask scores (0 = no masking)
    // - variant: variant ID in format chr-pos-ref-alt
    const url = `${baseUrl}/spliceai/?hg=${assembly}&bc=basic&distance=500&mask=0&variant=${variantId}`

    const response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json'
      }
    })

    if (!response.ok) {
      throw new Error(`SpliceAI API error: ${response.status}`)
    }

    return await response.json()
  }

  /**
   * Extract scores from SpliceAI response
   * Prioritizes MANE Select transcript, then first available
   */
  private extractScores(data: SpliceAIResponse): SpliceAIScores | null {
    const scores = data.scores
    if (!scores || scores.length === 0) {
      return null
    }

    // Find MANE Select transcript (t_priority = "MS")
    let selectedScore = scores.find((s) => s.t_priority === 'MS')

    // Fall back to first score if no MANE Select
    if (!selectedScore) {
      selectedScore = scores[0]
    }

    // Parse string scores to numbers
    const ds_ag = parseFloat(selectedScore.DS_AG)
    const ds_al = parseFloat(selectedScore.DS_AL)
    const ds_dg = parseFloat(selectedScore.DS_DG)
    const ds_dl = parseFloat(selectedScore.DS_DL)

    // Calculate max delta
    const max_delta = Math.max(ds_ag, ds_al, ds_dg, ds_dl)

    return {
      max_delta,
      ds_ag,
      ds_al,
      ds_dg,
      ds_dl,
      gene: selectedScore.g_name ?? null,
      transcript: selectedScore.t_id ?? null
    }
  }

  /**
   * Get cached response
   */
  getCached(cacheKey: string): { data: SpliceAIResponse; createdAt: number } | null {
    const cached = this.cache.get(cacheKey)
    if (!cached) return null

    try {
      const data = SpliceAIResponseSchema.parse(JSON.parse(cached.data))
      return { data, createdAt: cached.createdAt }
    } catch (e) {
      mainLogger.warn(
        'Corrupted SpliceAI cache entry for ' +
          cacheKey +
          ': ' +
          (e instanceof Error ? e.message : String(e)),
        'api'
      )
      return null
    }
  }

  clearCache(): void {
    this.cache.clearByPrefix('spliceai:')
  }
}
