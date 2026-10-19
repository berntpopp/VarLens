/**
 * SQLite gene-panel resolution for a query filter: turns the IPC-level panel
 * request (`active_panel_ids` + `panel_padding_bp`) into concrete
 * `panel_intervals` on the connection that will run the query.
 *
 * Used by the read-pool worker (case and cohort queries) and by the shortlist
 * service. The region rules themselves are shared with PostgreSQL in
 * `shared/filters/panel-intervals.ts`.
 */
import { mainLogger } from '../services/MainLogger'
import type { CaseRepository } from './CaseRepository'
import type { GeneReferenceDb } from './GeneReferenceDb'
import type { PanelRepository } from './PanelRepository'
import { NotFoundError } from './errors'

/** The repository panel resolution reads from. */
export interface PanelResolutionRepositories {
  panels: Pick<PanelRepository, 'computeIntervals'>
  cases?: Pick<CaseRepository, 'getCase'>
}

/** Minimal shape for a filter object that may carry panel IPC fields */
export interface PanelAwareFilter {
  active_panel_ids?: number[]
  panel_padding_bp?: number
  genome_build?: string
  panel_intervals?: Array<{ chr: string; start: number; end: number }>
  [key: string]: unknown
}

/**
 * Resolve panel intervals within the worker thread so the main thread
 * is not blocked by the computation.
 *
 * Mutates `filter` in place: sets `panel_intervals` and removes
 * `active_panel_ids` / `panel_padding_bp` so the repository does not see
 * IPC-only fields. `genome_build` is removed only after a single-case
 * resolution (where it is a lookup hint); it is kept for cohort queries and
 * whenever there is no panel to resolve.
 *
 * Nothing is resolved only when NO panel is actually configured
 * (`active_panel_ids` is absent or empty) — that is the sole legitimate
 * "nothing to resolve" case.
 *
 * @param filter    Query filter object (variants or cohort)
 * @param repos     Repository collection
 * @param geneRefDb Gene reference database (for panel interval computation)
 * @param caseId    Set for a single-case query; omit for cohort mode.
 * @throws If a panel IS configured (`active_panel_ids` non-empty) but
 *         `geneRefDb` is unavailable, or if a configured panel's interval
 *         computation itself fails (e.g. a corrupt gene reference DB or a
 *         panel/gene lookup error). This MUST propagate — `dispatchTask`
 *         lets it bubble to the pool caller so the failure surfaces as a
 *         SerializableError instead of silently running the query unfiltered
 *         under an active gene-panel restriction (a clinical-safety hazard:
 *         a dropped filter must not look identical to "panel matched
 *         everything").
 */
export function resolvePanelIntervalsInPlace(
  filter: PanelAwareFilter,
  repos: PanelResolutionRepositories,
  geneRefDb: GeneReferenceDb | null,
  caseId?: number
): void {
  const panelIds = filter.active_panel_ids
  if (panelIds === undefined || panelIds.length === 0) {
    // Only the panel request fields go. `genome_build` is not one of them: on
    // a cohort query it is the build restriction, and "no panel" must never
    // widen the result to every build.
    delete filter.active_panel_ids
    delete filter.panel_padding_bp
    return
  }

  if (geneRefDb === null) {
    // A panel IS configured (active_panel_ids is non-empty) but there is no
    // gene reference DB to resolve it against. This must not be treated as
    // "no panel" and silently run the query unfiltered — that would look
    // identical to the panel legitimately matching every variant, which is
    // a clinical-safety hazard for a diagnostic tool. Throw so the caller
    // sees a structured error instead of a silently dropped filter.
    const message =
      'Cannot resolve active gene panel filter: gene reference database is unavailable'
    mainLogger.error(message, 'db-worker')
    throw new Error(message)
  }

  const paddingBp = filter.panel_padding_bp ?? 5000
  let genomeBuild = filter.genome_build
  if (genomeBuild === undefined && caseId !== undefined && repos.cases !== undefined) {
    try {
      const caseRow = repos.cases.getCase(caseId)
      if (
        caseRow?.genome_build !== undefined &&
        caseRow.genome_build !== null &&
        caseRow.genome_build !== ''
      ) {
        genomeBuild = caseRow.genome_build
      }
    } catch (err) {
      if (!(err instanceof NotFoundError)) throw err
      // Fall back to default GRCh38 if case is not found
    }
  }
  genomeBuild = genomeBuild ?? 'GRCh38'

  // A panel IS active here (panelIds is non-empty and geneRefDb is available),
  // so a thrown error means the computation itself failed — it must propagate
  // rather than be swallowed into a silent unfiltered query.
  try {
    const intervals = repos.panels.computeIntervals(panelIds, genomeBuild, paddingBp, geneRefDb)
    if (intervals.length > 0) {
      filter.panel_intervals = intervals
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    mainLogger.error(
      `Failed to compute panel intervals for active gene panel(s): ${message}`,
      'db-worker'
    )
    throw error instanceof Error ? error : new Error(message)
  }

  delete filter.active_panel_ids
  delete filter.panel_padding_bp
  // `genome_build` is an IPC-only hint on a single-case filter, but on a cohort
  // query it IS the build restriction: dropping it there would mix builds into
  // the result whenever a panel is active (issue #447).
  if (caseId !== undefined) delete filter.genome_build
}
