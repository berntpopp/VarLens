/**
 * useShortlistQuery — reactive bridge between `ShortlistPanel` and the
 * `variants:shortlist` IPC handler.
 *
 * Wave 4 of the unified shortlist rollout. Exposes:
 *
 *   shortlistPresets   ComputedRef<FilterPreset[]> — visible presets whose
 *                      `filterJson.shortlist` is populated. Resilient to
 *                      missing `kind` during partial rollouts: the
 *                      presence of `filterJson.shortlist` is the source
 *                      of truth.
 *   selectedPresetId   Ref<number | null> — auto-selected to the first
 *                      shortlist preset when they load.
 *   result             Ref<ShortlistResult | null> — the envelope returned
 *                      by the IPC handler, or null on error.
 *   loading / error    Fetch state.
 *   refresh            Manual re-fetch. Useful for toolbar "Refresh" buttons
 *                      and test harnesses.
 *
 * Lifecycle note (spec §6):
 *
 *   The `variants:annotationChanged` subscription MUST be set up at the
 *   setup() top level, NOT inside `onMounted`. Nesting under `onMounted`
 *   leaves a race window during SSR / test renders where an early event
 *   can fire before the listener is wired. Subscribing at setup() top
 *   level + tearing down via `onBeforeUnmount(unsubscribe)` is
 *   deterministic across all rendering paths.
 *
 * Spec: .planning/specs/2026-04-11-unified-shortlist-ranked-view-design.md (§6)
 */

import { ref, shallowRef, markRaw, watch, onBeforeUnmount, type Ref } from 'vue'
import { useFilterPresetStore } from './useFilterPresetStore'
import { useApiService } from './useApiService'
import { logService } from '../services/LogService'
import { isIpcError, unwrapIpcResult } from '../../../shared/types/errors'
import type { ShortlistResult } from '../../../shared/types/shortlist'
import type { AnnotationChangeEvent } from '../../../shared/types/api'

export function useShortlistQuery(caseId: Ref<number>) {
  const presetStore = useFilterPresetStore()
  const { api } = useApiService()

  // Defensive: make sure the shared preset store is populated. `FilterToolbar`
  // normally loads presets on its own `onMounted`, but when ShortlistPanel is
  // the active (default) tab on first render, `v-show` mounts the toolbar AND
  // the panel in the same tick — without this call the toolbar's async load
  // would race the shortlist auto-select and leave the picker empty on cold
  // starts. Idempotent: if the store is already populated, the roundtrip
  // just overwrites with the same data.
  void presetStore.loadPresets()

  // Shortlist presets only; the filter presets of the drawer are a separate list.
  const shortlistPresets = presetStore.visibleShortlistPresets

  const selectedPresetId = ref<number | null>(null)

  // `result` holds the shortlist envelope. Use `shallowRef` so Vue does not
  // deep-walk the row buffer into reactive proxies, and `markRaw` each ingested
  // row on assignment (below) to cut per-row proxy overhead on the hot path.
  const result = shallowRef<ShortlistResult | null>(null)
  const loading = ref(false)
  const error = ref<Error | null>(null)

  // ─── Concurrent-fetch race guard ────────────────────────────────────────────
  // `fetch()` can fire from several reactive sources simultaneously:
  //   - preset selection change
  //   - case id change (parent route navigation)
  //   - annotation-changed broadcast
  //   - manual refresh() button
  // A slower earlier request can resolve AFTER a newer one, which would
  // otherwise overwrite `result` with stale data. We tag every fetch with
  // a monotonically increasing id and only commit its result when the id
  // still matches the most-recently-issued request.
  let nextRequestId = 0
  let activeRequestId = 0

  /**
   * Run the shortlist query for the current `selectedPresetId` + `caseId`.
   * No-op when `selectedPresetId` has not been assigned yet.
   */
  async function fetch(): Promise<void> {
    const presetId = selectedPresetId.value
    if (presetId == null) return
    if (api === undefined) return

    const currentCaseId = caseId.value
    const requestId = ++nextRequestId
    activeRequestId = requestId

    loading.value = true
    error.value = null
    try {
      const envelope = unwrapIpcResult(
        await api.variants.shortlist({
          caseId: currentCaseId,
          presetId
        })
      )
      // Drop stale results — a newer request has been issued since this
      // call started, so we let the newer call commit its own state.
      if (requestId !== activeRequestId) return
      // `markRaw` each ingested row so Vue never wraps them in reactive
      // proxies. Paired with the `shallowRef` above this keeps the shortlist
      // row buffer proxy-free on the hot path.
      result.value = { ...envelope, rows: envelope.rows.map((r) => markRaw(r)) }
      logService.info(
        `shortlist loaded: ${envelope.rows.length} rows in ${envelope.elapsedMs}ms`,
        'shortlist.fetch'
      )
    } catch (e) {
      if (requestId !== activeRequestId) return
      error.value = isIpcError(e)
        ? new Error(e.userMessage ?? e.message)
        : e instanceof Error
          ? e
          : new Error(String(e))
      result.value = null
      logService.error(`shortlist fetch failed: ${error.value.message}`, 'shortlist.fetch')
    } finally {
      if (requestId === activeRequestId) {
        loading.value = false
      }
    }
  }

  // Re-fetch when the selected preset id or the case id changes. `immediate`
  // is intentionally false — the auto-select watcher below will assign
  // `selectedPresetId` on first run, which in turn wakes this watcher.
  watch([selectedPresetId, caseId], () => {
    void fetch()
  })

  // Auto-select first shortlist preset when they load (async). Runs with
  // `immediate: true` so the initial render path doesn't wait for a preset
  // store round-trip before kicking off the fetch pipeline.
  watch(
    shortlistPresets,
    (presets) => {
      if (selectedPresetId.value == null && presets.length > 0) {
        selectedPresetId.value = presets[0].id
      }
    },
    { immediate: true }
  )

  // ─── Annotation-change subscription (setup() top-level) ────────────────────
  //
  // MUST be here, not inside onMounted. See lifecycle note in the module
  // docblock above. Tear down via onBeforeUnmount so component teardown
  // fires the unsubscribe exactly once.
  //
  // When running outside Electron (`api === undefined`) there is no IPC to
  // subscribe to, so we install a no-op unsubscribe to keep the cleanup
  // path uniform.
  const unsubscribeAnnotations: () => void =
    api !== undefined
      ? api.variants.onAnnotationChanged((ev: AnnotationChangeEvent) => {
          if (ev.caseId === caseId.value) {
            void fetch()
          }
        })
      : () => {}
  onBeforeUnmount(() => {
    unsubscribeAnnotations()
  })

  return {
    shortlistPresets,
    selectedPresetId,
    result,
    loading,
    error,
    refresh: fetch
  }
}
