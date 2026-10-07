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
import { DEFAULT_PANEL_GENOME_BUILD } from '../../../shared/filters/panel-intervals'

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
 * @returns Array of genomic intervals. Empty ONLY when the active panel(s)
 *          contain no genes at all — there is nothing to restrict on, so that
 *          is a legitimate "no restriction" result and callers run the query
 *          unfiltered. Identical on PostgreSQL (the rule lives in
 *          `shared/filters/panel-intervals.ts`).
 * @throws {PanelRegionsUnavailableError} when the panel(s) DO contain genes
 *         but none has coordinates for `genome_build`. This is a typed,
 *         user-facing error: an empty result would show every variant while
 *         the user believes a panel is active.
 * @throws If the computation itself fails (e.g. the bundled gene reference
 *         DB cannot be opened, or the panel/gene lookup errors). Callers
 *         MUST let this propagate — a caught computation failure must never
 *         be treated the same as "no panel configured", since that would
 *         silently widen the query to return unfiltered results under an
 *         active gene-panel restriction (a clinical-safety hazard).
 */
export function computePanelIntervals(
  db: DatabaseService,
  params: PanelIntervalParams,
  caseId: number | undefined,
  source: string
): GenomicInterval[] {
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

  try {
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
    const message = error instanceof Error ? error.message : String(error)
    // Do NOT swallow this into "no panel filter" — a panel IS configured here
    // (callers only invoke computePanelIntervals when active_panel_ids is
    // non-empty), so a failure must surface rather than silently widen the
    // query to unfiltered results. Log for diagnostics, then propagate so
    // wrapHandler turns it into a SerializableError at the IPC boundary.
    mainLogger.error(
      `Failed to compute panel intervals for active gene panel(s): ${message}`,
      source
    )
    throw error instanceof Error ? error : new Error(message)
  }
}

/** The cohort query fields that take part in panel resolution. */
interface CohortPanelRequest {
  active_panel_ids?: number[]
  panel_padding_bp?: number
  genome_build?: string
  panel_intervals?: GenomicInterval[]
}

/**
 * Bring SQLite cohort params into the form `CohortService` understands, on
 * the calling thread: the genome build defaults to GRCh38 (what the cohort
 * table shows when none is selected) and the active panel becomes concrete
 * `panel_intervals` for THAT build.
 *
 * Every SQLite cohort read that does not hand the panel to the read-pool
 * worker goes through here — the no-pool listing fallback and the cohort
 * export — so both restrict exactly like the on-screen table.
 *
 * @throws See {@link computePanelIntervals}.
 */
export function resolveCohortPanelOnCallingThread<T extends CohortPanelRequest>(
  db: DatabaseService,
  params: T,
  source: string
): T {
  const resolved: T = { ...params, genome_build: params.genome_build ?? DEFAULT_PANEL_GENOME_BUILD }
  const panelIds = resolved.active_panel_ids
  if (panelIds !== undefined && panelIds.length > 0) {
    resolved.panel_intervals = computePanelIntervals(
      db,
      {
        active_panel_ids: panelIds,
        panel_padding_bp: resolved.panel_padding_bp,
        genome_build: resolved.genome_build
      },
      undefined, // cohort mode: no specific case, sample any variant
      source
    )
  }
  // IPC-only fields must not reach the service.
  delete resolved.active_panel_ids
  delete resolved.panel_padding_bp
  return resolved
}
