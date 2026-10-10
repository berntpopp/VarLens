/**
 * Unit tests for useShortlistQuery composable (Wave 4 — unified shortlist).
 *
 * Covers:
 *  1. Auto-selects the first visible shortlist preset
 *  2. Fetches when preset is auto-selected
 *  3. Re-fetches on annotation-change event for the same case
 *  4. Ignores annotation-change events for other cases
 *  5. Exposes loading state during fetch
 *  6. Captures errors and sets result to null
 *  7. Unsubscribes onBeforeUnmount
 *  8. refresh() triggers a fetch
 *
 * Spec: .planning/specs/2026-04-11-unified-shortlist-ranked-view-design.md (§6)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref, nextTick, type Ref } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import { flushPromises, withSetup } from '../../utils/test-helpers'
import type { AnnotationChangeEvent } from '../../../src/shared/types/api'
import { ErrorCode } from '../../../src/shared/types/errors'
import type { FilterPreset } from '../../../src/shared/types/filter-presets'

// ─── Mock useFilterPresetStore so every harness call gets the same ref ────────
// Needs to live outside the harness so the `vi.mock` hoisting sees it.
let mockVisiblePresets: Ref<FilterPreset[]>

const mockLoadPresets = vi.fn().mockResolvedValue(undefined)
vi.mock('../../../src/renderer/src/composables/useFilterPresetStore', () => ({
  useFilterPresetStore: () => ({
    visibleShortlistPresets: mockVisiblePresets,
    loadPresets: mockLoadPresets
  })
}))

// Import under test — AFTER vi.mock call so the mock resolves correctly.
import { useShortlistQuery } from '../../../src/renderer/src/composables/useShortlistQuery'

type AnnotationCallback = (ev: AnnotationChangeEvent) => void

/**
 * Build a fresh Vue setup context + window.api mocks around the composable.
 * Returns both the composable result and the app handle for unmount().
 */
function harness(caseId = 1) {
  const shortlistMock = vi.fn().mockResolvedValue({
    rows: [{ id: 1, rank: 1, rank_score: 0.9 }],
    totalCandidates: 10,
    presetUsed: null,
    elapsedMs: 15
  })

  let annotationCb: AnnotationCallback | null = null
  const unsubscribe = vi.fn()
  const onAnnotationChanged = vi.fn((cb: AnnotationCallback) => {
    annotationCb = cb
    return unsubscribe
  })

  // Minimal window.api surface for this test. Only the methods used by the
  // composable need to be present.
  ;(globalThis as unknown as { window: Record<string, unknown> }).window = {
    api: {
      variants: {
        shortlist: shortlistMock,
        onAnnotationChanged
      }
    }
  }

  mockVisiblePresets = ref<FilterPreset[]>([
    {
      id: 1,
      name: 'Tier 1',
      description: null,
      filterJson: {
        // ShortlistConfig shape — only presence of the key matters for
        // the composable's computed filter, contents are opaque here.
        shortlist: {
          baseFilters: {},
          topN: 50,
          rankConfig: {
            weights: { impact: 1, pathogenicity: 1, rarity: 1, clinvar: 1, phenotype: 1 }
          }
        }
      } as unknown as FilterPreset['filterJson'],
      kind: 'shortlist',
      isBuiltIn: false,
      isVisible: true,
      sortOrder: 0,
      createdAt: 0,
      updatedAt: 0
    }
  ])

  const caseIdRef = ref(caseId)

  const [composable, app] = withSetup(() => useShortlistQuery(caseIdRef))

  return {
    composable,
    app,
    shortlistMock,
    unsubscribe,
    onAnnotationChanged,
    caseIdRef,
    triggerAnnotation: (ev: AnnotationChangeEvent): void => {
      annotationCb?.(ev)
    }
  }
}

describe('useShortlistQuery', () => {
  let app: { unmount: () => void } | null = null

  beforeEach(() => {
    setActivePinia(createPinia())
    app = null
    mockLoadPresets.mockClear()
  })

  afterEach(() => {
    if (app) {
      try {
        app.unmount()
      } catch {
        // ignore — some tests already unmount inside the body
      }
      app = null
    }
    vi.restoreAllMocks()
  })

  it('kicks off loadPresets() on setup (defensive cold-start guard)', async () => {
    const h = harness()
    app = h.app
    await nextTick()
    // Verifies the fix for a production bug where ShortlistPanel mounted
    // alongside FilterToolbar could race against FilterToolbar's onMounted
    // load, leaving the preset dropdown empty on cold starts.
    expect(mockLoadPresets).toHaveBeenCalledTimes(1)
  })

  it('auto-selects the first visible shortlist preset', async () => {
    const h = harness()
    app = h.app
    await nextTick()
    expect(h.composable.selectedPresetId.value).toBe(1)
  })

  it('fetches when a preset is auto-selected', async () => {
    const h = harness()
    app = h.app
    await flushPromises()
    await flushPromises()

    expect(h.shortlistMock).toHaveBeenCalledWith({ caseId: 1, presetId: 1 })
    expect(h.composable.result.value).not.toBeNull()
    expect(h.composable.result.value?.rows).toHaveLength(1)
  })

  it('re-fetches on annotation-change event for the same case', async () => {
    const h = harness()
    app = h.app
    await flushPromises()
    await flushPromises()

    h.shortlistMock.mockClear()
    h.triggerAnnotation({ caseId: 1, variantId: 1, kind: 'star' })
    await flushPromises()

    expect(h.shortlistMock).toHaveBeenCalledTimes(1)
    expect(h.shortlistMock).toHaveBeenCalledWith({ caseId: 1, presetId: 1 })
  })

  it('ignores annotation-change events for other cases', async () => {
    const h = harness(1)
    app = h.app
    await flushPromises()
    await flushPromises()

    h.shortlistMock.mockClear()
    // Fire an event for a DIFFERENT case id — composable should ignore it.
    h.triggerAnnotation({ caseId: 999, variantId: 42, kind: 'star' })
    await flushPromises()

    expect(h.shortlistMock).not.toHaveBeenCalled()
  })

  it('exposes loading state during fetch', async () => {
    const h = harness()
    app = h.app

    // Replace the mock with one whose promise we control, then force a fresh
    // fetch via refresh().
    let resolve!: (v: unknown) => void
    h.shortlistMock.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r
        })
    )

    // Drain the initial auto-select fetch first. The first call used the
    // canned mockResolvedValue, NOT the mockImplementationOnce above — that
    // one is queued for the next call.
    await flushPromises()
    await flushPromises()

    // Trigger a new fetch; loading should flip to true immediately.
    const pending = h.composable.refresh()
    expect(h.composable.loading.value).toBe(true)

    resolve({ rows: [], totalCandidates: 0, presetUsed: null, elapsedMs: 1 })
    await pending
    await flushPromises()

    expect(h.composable.loading.value).toBe(false)
  })

  it('captures errors and sets result to null', async () => {
    const h = harness()
    app = h.app

    // Drain the initial auto-select fetch (resolves with the canned value).
    await flushPromises()
    await flushPromises()

    // Queue a rejection for the next call, then force a re-fetch via refresh().
    h.shortlistMock.mockRejectedValueOnce(new Error('boom'))
    await h.composable.refresh()

    expect(h.composable.error.value).toBeInstanceOf(Error)
    expect(h.composable.error.value?.message).toBe('boom')
    expect(h.composable.result.value).toBeNull()
    expect(h.composable.loading.value).toBe(false)
  })

  it('unwraps serialized IPC errors before reading shortlist rows', async () => {
    const h = harness()
    app = h.app

    await flushPromises()
    await flushPromises()

    h.shortlistMock.mockResolvedValueOnce({
      code: ErrorCode.DB_ERROR,
      message: 'DatabaseService is not available for postgres sessions',
      userMessage: 'A database error occurred. Please try again.'
    })
    await h.composable.refresh()

    expect(h.composable.error.value).toBeInstanceOf(Error)
    expect(h.composable.error.value?.message).toBe('A database error occurred. Please try again.')
    expect(h.composable.result.value).toBeNull()
    expect(h.composable.loading.value).toBe(false)
  })

  it('unsubscribes onBeforeUnmount', async () => {
    const h = harness()
    app = h.app
    await flushPromises()

    expect(h.unsubscribe).not.toHaveBeenCalled()
    h.app.unmount()
    app = null
    expect(h.unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('refresh() triggers a fetch', async () => {
    const h = harness()
    app = h.app
    await flushPromises()
    await flushPromises()

    h.shortlistMock.mockClear()
    await h.composable.refresh()

    expect(h.shortlistMock).toHaveBeenCalledTimes(1)
    expect(h.shortlistMock).toHaveBeenCalledWith({ caseId: 1, presetId: 1 })
  })

  it('drops stale results when a slower earlier fetch resolves after a newer one', async () => {
    // Race guard regression: a preset change or annotation broadcast can
    // issue a second fetch before the first one resolves. If the earlier
    // (slower) call resolved last WITHOUT the guard, its stale envelope
    // would clobber the newer result.
    const h = harness()
    app = h.app
    await flushPromises()
    await flushPromises()

    let resolveSlow!: (v: unknown) => void
    let resolveFast!: (v: unknown) => void

    // First call (slow) — deliberately held open.
    h.shortlistMock.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolveSlow = r
        })
    )
    // Second call (fast) — resolves immediately.
    h.shortlistMock.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolveFast = r
        })
    )

    // Kick off the slow fetch (nothing awaited — we want it in flight).
    const slowPending = h.composable.refresh()
    // Immediately kick off the fast fetch, which becomes the "newest" one.
    const fastPending = h.composable.refresh()

    // Resolve fast FIRST, then slow. The composable should commit the
    // fast result and ignore the slow one as stale.
    resolveFast({
      rows: [{ id: 2, rank: 1, rank_score: 0.95 }],
      totalCandidates: 5,
      presetUsed: null,
      elapsedMs: 3
    })
    await fastPending
    await flushPromises()

    resolveSlow({
      rows: [{ id: 999, rank: 1, rank_score: 0.0 }],
      totalCandidates: 1234,
      presetUsed: null,
      elapsedMs: 99
    })
    await slowPending
    await flushPromises()

    // Fast result must be the one that stuck. The stale slow envelope
    // (totalCandidates=1234) must NOT have replaced it.
    expect(h.composable.result.value?.totalCandidates).toBe(5)
    expect(h.composable.result.value?.elapsedMs).toBe(3)
    expect(h.composable.loading.value).toBe(false)
  })

  it('clears result immediately when caseId switches', async () => {
    const h = harness(1)
    app = h.app
    await flushPromises()
    expect(h.composable.result.value).not.toBeNull()

    let resolveCase2!: (value: unknown) => void
    h.shortlistMock.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolveCase2 = r
        })
    )

    h.caseIdRef.value = 2
    await nextTick()

    // Immediately after case switch, previous case rows must be cleared
    expect(h.composable.result.value).toBeNull()

    resolveCase2({
      rows: [{ id: 100, rank: 1, rank_score: 0.8 }],
      totalCandidates: 1,
      presetUsed: null,
      elapsedMs: 5
    })
    await flushPromises()

    expect(h.composable.result.value?.rows[0].id).toBe(100)
  })
})
