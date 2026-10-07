/**
 * Gene-panel resolution warning for a panel-filtered table.
 *
 * A panel gene without coordinates for the genome build is left out of the
 * panel restriction; the query still runs. This composable asks the backend
 * which genes those are (`panels.resolutionStatus`) and turns the answer into
 * the warning both the case view and the cohort view show.
 *
 * Wiring (same on both views — cohort parity):
 *   - the view calls `providePanelResolutionStatus(scope)` with the panel ids
 *     of the filter it actually applies, plus its case id (case view) or its
 *     selected genome build (cohort view);
 *   - the shared `SlimFilterToolbar` renders `PanelUnmappedGenesWarning`,
 *     which reads the warning through `usePanelUnmappedGenesWarning()`.
 */
import { computed, inject, onActivated, provide, toValue, watch } from 'vue'
import type { ComputedRef, InjectionKey, MaybeRefOrGetter } from 'vue'
import { useQuery, useQueryCache } from '@pinia/colada'
import type { PanelResolutionRequest, PanelResolutionStatus } from '../../../shared/types/panels'
import { queryKeys } from '../queries/keys'
import { panelResolutionQuery } from '../queries/panels'
import { usePanelManager } from './usePanelManager'

/** Unmapped gene symbols named inline before the list is cut with "+N more". */
export const MAX_INLINE_UNMAPPED_GENES = 5

/** Which panel restriction the surrounding table applies. */
export interface PanelResolutionScope {
  /** Active panel ids of the APPLIED filter; empty / undefined = no panel. */
  panelIds: MaybeRefOrGetter<readonly number[] | undefined>
  /** Case view: the case whose genome build the panel is resolved for. */
  caseId?: MaybeRefOrGetter<number | null | undefined>
  /** Cohort view: the selected genome build. */
  genomeBuild?: MaybeRefOrGetter<string | null | undefined>
}

/** View model of the warning; `null` when there is nothing to warn about. */
export interface PanelUnmappedGenesWarning {
  /**
   * `unmapped`: some panel genes are not applied. `unverified`: the check
   * itself failed, so it is unknown whether the whole panel is applied.
   */
  kind: 'unmapped' | 'unverified'
  /** The sentence without the gene list. */
  summary: string
  /** The first symbols, named inline. */
  inlineSymbols: string[]
  /** How many symbols the inline list leaves out ("+N more"). */
  hiddenCount: number
  /** Every unmapped symbol, for the expanded view. */
  allSymbols: string[]
  /** One line: summary, inline symbols and "+N more". */
  text: string
}

export interface PanelResolutionState {
  status: ComputedRef<PanelResolutionStatus | null>
  /** True when the last status request for the current scope failed. */
  failed: ComputedRef<boolean>
  warning: ComputedRef<PanelUnmappedGenesWarning | null>
}

const UNVERIFIED_SUMMARY =
  'Could not check whether every gene of the active panel has coordinates for this genome build'

/** Build the warning for a resolution status (pure; `null` = no warning). */
export function buildPanelUnmappedGenesWarning(
  status: PanelResolutionStatus | null,
  maxInline: number = MAX_INLINE_UNMAPPED_GENES
): PanelUnmappedGenesWarning | null {
  if (status === null || status.unmappedCount === 0) return null
  const allSymbols = status.unmappedGenes.map((gene) => gene.symbol)
  const inlineSymbols = allSymbols.slice(0, maxInline)
  const hiddenCount = allSymbols.length - inlineSymbols.length
  const one = status.unmappedCount === 1
  const summary =
    `${status.unmappedCount} of ${status.totalGenes} panel genes ` +
    `${one ? 'has' : 'have'} no coordinates for ${status.genomeBuild} ` +
    `and ${one ? 'is' : 'are'} not applied`
  const more = hiddenCount > 0 ? ` +${hiddenCount} more` : ''
  return {
    kind: 'unmapped',
    summary,
    inlineSymbols,
    hiddenCount,
    allSymbols,
    text: `${summary}: ${inlineSymbols.join(', ')}${more}`
  }
}

function toRequest(scope: PanelResolutionScope): PanelResolutionRequest | null {
  const panelIds = [...new Set(toValue(scope.panelIds) ?? [])].sort((a, b) => a - b)
  if (panelIds.length === 0) return null
  const request: PanelResolutionRequest = { panelIds }
  const caseId = toValue(scope.caseId)
  if (caseId != null && caseId > 0) request.caseId = caseId
  const genomeBuild = toValue(scope.genomeBuild)
  if (genomeBuild != null && genomeBuild !== '') request.genomeBuild = genomeBuild
  return request
}

/**
 * Track the resolution status of `scope`: a query keyed by the scope
 * (`queries/panels.ts`), so a changed scope never shows the answer for the
 * previous panel, case or build. It is asked again when the panel list is
 * reloaded (every panel edit does that) and when a kept-alive view is shown
 * again.
 */
export function usePanelResolutionStatus(scope: PanelResolutionScope): PanelResolutionState {
  const cache = useQueryCache()
  const { panels } = usePanelManager()
  const query = useQuery(() => panelResolutionQuery(toRequest(scope)))
  const failed = computed(() => query.status.value === 'error')
  const status = computed(() => (failed.value ? null : (query.data.value ?? null)))

  function refresh(): void {
    void cache.invalidateQueries({ key: queryKeys.panelResolutionRoot() }).catch(() => undefined)
  }
  watch(panels, refresh)
  onActivated(refresh)

  const warning = computed<PanelUnmappedGenesWarning | null>(() => {
    if (failed.value) {
      return {
        kind: 'unverified',
        summary: UNVERIFIED_SUMMARY,
        inlineSymbols: [],
        hiddenCount: 0,
        allSymbols: [],
        text: UNVERIFIED_SUMMARY
      }
    }
    return buildPanelUnmappedGenesWarning(status.value)
  })

  return { status, failed, warning }
}

const PanelUnmappedGenesWarningKey: InjectionKey<ComputedRef<PanelUnmappedGenesWarning | null>> =
  Symbol('PanelUnmappedGenesWarning')

/** Call in the view that owns a panel-filtered table (see module comment). */
export function providePanelResolutionStatus(scope: PanelResolutionScope): PanelResolutionState {
  const state = usePanelResolutionStatus(scope)
  provide(PanelUnmappedGenesWarningKey, state.warning)
  return state
}

/** The warning of the nearest providing view; `null` when none provides one. */
export function usePanelUnmappedGenesWarning(): ComputedRef<PanelUnmappedGenesWarning | null> {
  return inject(PanelUnmappedGenesWarningKey, () => computed(() => null), true)
}
