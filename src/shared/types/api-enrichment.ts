/**
 * Type definitions for API enrichment results
 *
 * Used for VEP and HPO API responses in IPC communication
 */

import type { VepResponse } from '../../main/services/api/schemas/vep-response'
import type { HpoTerm } from '../../main/services/api/schemas/hpo-response'

/**
 * Cache metadata for UI display
 */
export interface CacheInfo {
  /** Whether the response came from cache */
  cached: boolean
  /** Unix timestamp of when response was cached (null if not cached) */
  cachedAt: number | null
}

/**
 * VEP API fetch result
 * Success case includes validated VEP response data and cache info
 * Failure case includes error message and offline flag
 */
export type VepFetchResult =
  | {
      success: true
      data: VepResponse
      cacheInfo: CacheInfo
    }
  | {
      success: false
      error: string
      offline: boolean
    }

/**
 * HPO search result
 * Success case includes array of parsed HPO terms
 * Failure case includes error message and offline flag
 */
export type HpoSearchResult =
  | {
      success: true
      terms: HpoTerm[]
    }
  | {
      success: false
      error: string
      offline: boolean
    }

/**
 * Cache size information for settings page
 */
export interface CacheSizeInfo {
  /** Number of cached VEP responses */
  vepCount: number
  /** Number of cached HPO responses */
  hpoCount: number
  /** Total size in bytes */
  totalBytes: number
}
