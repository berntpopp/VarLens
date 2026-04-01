/**
 * MyVariant.info API client for REVEL and other prediction scores
 *
 * Fetches variant annotations from myvariant.info with:
 * - SQLite caching with 30-day TTL
 * - Zod response validation
 * - Rate limiting (courtesy, no documented limits)
 *
 * Reference: https://docs.myvariant.info/en/latest/
 */

import Bottleneck from 'bottleneck'
import { z } from 'zod'
import { ApiCache } from './ApiCache'
import { mainLogger } from '../MainLogger'

/**
 * Zod schema for myvariant.info dbnsfp response
 * Only extracting the scores we need
 */
const MyVariantScoresSchema = z.object({
  revel: z
    .object({
      score: z.union([z.number(), z.array(z.number())]).optional()
    })
    .optional(),
  cadd: z
    .object({
      phred: z.number().optional()
    })
    .optional(),
  sift: z
    .object({
      score: z.union([z.number(), z.array(z.number())]).optional(),
      pred: z.union([z.string(), z.array(z.string())]).optional()
    })
    .optional(),
  polyphen2: z
    .object({
      hdiv: z
        .object({
          score: z.union([z.number(), z.array(z.number())]).optional(),
          pred: z.union([z.string(), z.array(z.string())]).optional()
        })
        .optional()
    })
    .optional(),
  alphamissense: z
    .object({
      score: z.union([z.number(), z.array(z.number())]).optional(),
      pred: z.union([z.string(), z.array(z.string())]).optional()
    })
    .optional()
})

const MyVariantResponseSchema = z.object({
  _id: z.string().optional(),
  dbnsfp: MyVariantScoresSchema.optional(),
  error: z.boolean().optional(),
  notfound: z.boolean().optional()
})

export type MyVariantResponse = z.infer<typeof MyVariantResponseSchema>

/**
 * Extracted scores from myvariant.info
 */
export interface MyVariantScores {
  revel_score: number | null
  cadd_phred: number | null
  sift_score: number | null
  sift_pred: string | null
  polyphen_score: number | null
  polyphen_pred: string | null
  alphamissense_score: number | null
  alphamissense_pred: string | null
}

export interface MyVariantFetchResult {
  success: true
  scores: MyVariantScores
  cacheInfo: {
    cached: boolean
    cachedAt: number | null
  }
}

export interface MyVariantFetchError {
  success: false
  error: string
  offline: boolean
}

export type MyVariantResult = MyVariantFetchResult | MyVariantFetchError

export class MyVariantApiClient {
  private cache: ApiCache
  private limiter: Bottleneck
  private readonly baseUrl = 'https://myvariant.info/v1'

  constructor(cache: ApiCache) {
    this.cache = cache

    // Courtesy rate limiting - 10 req/sec
    this.limiter = new Bottleneck({
      maxConcurrent: 1,
      minTime: 100 // 100ms between requests = 10 req/sec
    })
  }

  /**
   * Fetch variant scores from myvariant.info
   *
   * @param chr - Chromosome (1-22, X, Y, MT)
   * @param pos - Genomic position (1-based)
   * @param ref - Reference allele
   * @param alt - Alternate allele
   * @param assembly - Genome assembly (hg38 or hg19)
   */
  async fetchVariantScores(
    chr: string,
    pos: number,
    ref: string,
    alt: string,
    assembly: 'hg38' | 'hg19' = 'hg38'
  ): Promise<MyVariantResult> {
    // Normalize chromosome
    const normalizedChr = chr.replace(/^chr/i, '')

    // Generate HGVS notation for myvariant.info
    // Format: chr17:g.43092919G>A
    const hgvs = `chr${normalizedChr}:g.${pos}${ref}>${alt}`
    const cacheKey = `myvariant:${assembly}:${hgvs}`

    // Check cache first
    const cached = this.cache.get(cacheKey)
    if (cached) {
      try {
        const data = MyVariantResponseSchema.parse(JSON.parse(cached.data))
        return {
          success: true,
          scores: this.extractScores(data),
          cacheInfo: {
            cached: true,
            cachedAt: cached.createdAt
          }
        }
      } catch (e) {
        // Cache corrupted, continue to fetch
        mainLogger.warn(
          `Corrupted myvariant cache entry for ${cacheKey}: ` +
            (e instanceof Error ? e.message : String(e)),
          'api'
        )
      }
    }

    try {
      const rawResponse = await this.limiter.schedule(() => this.makeRequest(hgvs, assembly))

      const data = MyVariantResponseSchema.parse(rawResponse)

      // Check if variant was found
      if (data.notfound === true) {
        return {
          success: false,
          error: 'Variant not found in myvariant.info',
          offline: false
        }
      }

      // Cache response
      this.cache.set(cacheKey, JSON.stringify(rawResponse), 30)

      return {
        success: true,
        scores: this.extractScores(data),
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

  private async makeRequest(hgvs: string, assembly: string): Promise<unknown> {
    const url = `${this.baseUrl}/variant/${encodeURIComponent(hgvs)}?fields=dbnsfp&assembly=${assembly}`

    const response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json'
      }
    })

    if (!response.ok) {
      throw new Error(`myvariant.info API error: ${response.status}`)
    }

    return await response.json()
  }

  /**
   * Extract scores from myvariant.info response
   * Handles both single values and arrays (takes first/max as appropriate)
   */
  private extractScores(data: MyVariantResponse): MyVariantScores {
    const dbnsfp = data.dbnsfp

    // Helper to get first value from number or array
    const getFirst = (val: number | number[] | undefined): number | null => {
      if (val === undefined) return null
      return Array.isArray(val) ? val[0] : val
    }

    // Helper to get max value from number or array (for scores where higher = worse)
    const getMax = (val: number | number[] | undefined): number | null => {
      if (val === undefined) return null
      return Array.isArray(val) ? Math.max(...val) : val
    }

    // Helper for string predictions
    const getFirstStr = (val: string | string[] | undefined): string | null => {
      if (val === undefined) return null
      return Array.isArray(val) ? val[0] : val
    }

    return {
      revel_score: getFirst(dbnsfp?.revel?.score),
      cadd_phred: dbnsfp?.cadd?.phred ?? null,
      // SIFT: lower is worse, so take min
      sift_score: getFirst(dbnsfp?.sift?.score),
      sift_pred: getFirstStr(dbnsfp?.sift?.pred),
      // PolyPhen: higher is worse, so take max
      polyphen_score: getMax(dbnsfp?.polyphen2?.hdiv?.score),
      polyphen_pred: getFirstStr(dbnsfp?.polyphen2?.hdiv?.pred),
      alphamissense_score: getFirst(dbnsfp?.alphamissense?.score),
      alphamissense_pred: getFirstStr(dbnsfp?.alphamissense?.pred)
    }
  }

  /**
   * Get cached response
   */
  getCached(cacheKey: string): { data: MyVariantResponse; createdAt: number } | null {
    const cached = this.cache.get(cacheKey)
    if (!cached) return null

    try {
      const data = MyVariantResponseSchema.parse(JSON.parse(cached.data))
      return { data, createdAt: cached.createdAt }
    } catch (e) {
      mainLogger.warn(
        'Corrupted myvariant cache entry for ' +
          cacheKey +
          ': ' +
          (e instanceof Error ? e.message : String(e)),
        'api'
      )
      return null
    }
  }

  clearCache(): void {
    this.cache.clearByPrefix('myvariant:')
  }
}
