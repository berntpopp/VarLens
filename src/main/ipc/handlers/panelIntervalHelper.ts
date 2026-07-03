/**
 * Shared helper for computing panel genomic intervals.
 *
 * Used by both variants.ts and cohort.ts IPC handlers to convert
 * active_panel_ids + padding into concrete genomic intervals for SQL filtering.
 * DRY: single implementation, two consumers.
 */

import { mainLogger } from '../../services/MainLogger'
import { getGeneReferenceDb } from '../../database/geneReferenceLoader'
import type { GenomicInterval } from '../../database/PanelRepository'
import type { DatabaseService } from '../../database/DatabaseService'

/**
 * In-memory cache for computed panel intervals.
 * Keyed on JSON.stringify({ panelIds, assembly, paddingBp, chrPrefix }).
 * Invalidated via clearPanelIntervalCache() when panel/gene data changes.
 */
const panelIntervalCache = new Map<string, GenomicInterval[]>()

/**
 * Clear the panel interval cache. Call this when panels or their genes change.
 */
export function clearPanelIntervalCache(): void {
  panelIntervalCache.clear()
}

/**
 * Parameters for panel interval computation
 */
export interface PanelIntervalParams {
  /** Active panel IDs to compute intervals for */
  active_panel_ids: number[]
  /** Padding in bp around gene regions (default: 5000) */
  panel_padding_bp?: number
  /** Genome build (default: GRCh38) */
  genome_build?: string
}

/**
 * Compute genomic intervals for the given panel IDs.
 *
 * @param db - DatabaseService instance for accessing panels and variants
 * @param params - Panel IDs, padding, and genome build
 * @param caseId - Optional case ID for detecting chr prefix from variants.
 *                 If omitted, falls back to sampling any variant in the database.
 * @param source - Logging source identifier (e.g. 'variants', 'cohort')
 * @returns Array of genomic intervals, or undefined if computation fails
 */
export function computePanelIntervals(
  db: DatabaseService,
  params: PanelIntervalParams,
  caseId: number | undefined,
  source: string
): GenomicInterval[] | undefined {
  const paddingBp = params.panel_padding_bp ?? 5000
  const genomeBuild = params.genome_build ?? 'GRCh38'

  // Detect chromosome prefix from existing variants
  let chrPrefix: boolean
  if (caseId !== undefined) {
    chrPrefix = db.variants.getChrPrefix(caseId)
  } else {
    // Cohort mode: sample any variant in the database
    const sampleRow = db.database.prepare('SELECT chr FROM variants LIMIT 1').get() as
      { chr: string } | undefined
    chrPrefix = sampleRow?.chr?.startsWith('chr') ?? false
  }

  try {
    const cacheKey = JSON.stringify({
      panelIds: params.active_panel_ids,
      assembly: genomeBuild,
      paddingBp,
      chrPrefix
    })

    const cached = panelIntervalCache.get(cacheKey)
    if (cached) {
      return cached
    }

    const geneRefDb = getGeneReferenceDb()
    const intervals = db.panels.computeIntervals(
      params.active_panel_ids,
      genomeBuild,
      paddingBp,
      geneRefDb,
      chrPrefix
    )
    panelIntervalCache.set(cacheKey, intervals)
    return intervals
  } catch (error) {
    mainLogger.warn(
      `Failed to compute panel intervals: ${error instanceof Error ? error.message : String(error)}`,
      source
    )
    // Continue without panel filtering rather than failing the query
    return undefined
  }
}
