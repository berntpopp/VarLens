/**
 * Type definitions for API enrichment results
 *
 * Used for VEP and HPO API responses in IPC communication
 */

import type {
  VepResponse,
  VepTranscriptConsequence
} from '../../main/services/api/schemas/vep-response'
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
      preferredTranscript: VepTranscriptConsequence | null
      allTranscripts: VepTranscriptConsequence[]
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

/**
 * MyVariant.info scores from dbnsfp
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

/**
 * MyVariant.info API fetch result
 */
export type MyVariantFetchResult =
  | {
      success: true
      scores: MyVariantScores
      cacheInfo: CacheInfo
    }
  | {
      success: false
      error: string
      offline: boolean
    }

/**
 * SpliceAI scores from Broad Institute API
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

/**
 * SpliceAI API fetch result
 */
export type SpliceAIFetchResult =
  | {
      success: true
      scores: SpliceAIScores
      cacheInfo: CacheInfo
    }
  | {
      success: false
      error: string
      offline: boolean
    }
