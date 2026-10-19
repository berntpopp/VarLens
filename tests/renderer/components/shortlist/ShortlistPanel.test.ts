/**
 * Unit tests for ShortlistPanel.vue — the host panel that composes
 * ShortlistTable + useShortlistQuery + preset picker into the case-view
 * Shortlist tab.
 *
 * These tests drive the panel through its four visual states by mocking
 * the `useShortlistQuery` composable so we can flip loading / error /
 * result at will. The annotations API is mocked via `useApiService` to
 * comply with the `no-restricted-syntax` ESLint rule that bans direct
 * `window.api.*` access from application code.
 *
 * Spec: .planning/specs/2026-04-11-unified-shortlist-ranked-view-design.md (§6)
 * Plan: .planning/plans/2026-04-11-unified-shortlist-plan.md (Task 5)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref } from 'vue'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import type { ShortlistResult, ShortlistRow } from '../../../../src/shared/types/shortlist'
import type { FilterPreset } from '../../../../src/shared/types/filter-presets'

// ─── Mock useShortlistQuery ────────────────────────────────────────────────
//
// Expose a stable `state` object keyed by refs so each test can mutate the
// state and remount the panel. The mock returns the same refs every call so
// changes flow into the mounted component reactively.
vi.mock('../../../../src/renderer/src/composables/useShortlistQuery', () => {
  const refresh = vi.fn()
  const state = {
    shortlistPresets: ref<Pick<FilterPreset, 'id' | 'name'>[]>([
      { id: 1, name: 'Tier 1 candidates' } as FilterPreset
    ]),
    selectedPresetId: ref<number | null>(1),
    result: ref<ShortlistResult | null>(null),
    loading: ref(false),
    error: ref<Error | null>(null),
    presetsLoading: ref(false),
    refresh
  }
  return {
    useShortlistQuery: () => state,
    __state: state
  }
})

// ─── Mock useApiService ────────────────────────────────────────────────────
//
// The panel's `onToggleStar` handler calls `api.annotations.upsertPerCase`
// via `useApiService()`. We expose the mock so tests can assert on its
// invocation signature.
const upsertPerCaseMock = vi
  .fn()
  .mockImplementation(
    async (caseId: number, variantId: number, updates: { starred?: boolean }) => ({
      id: 1,
      case_id: caseId,
      variant_id: variantId,
      per_case_comment: null,
      starred: updates.starred ? 1 : 0,
      acmg_classification: null,
      acmg_evidence: null,
      created_at: 0,
      updated_at: 0
    })
  )
const batchGetMock = vi.fn().mockImplementation(async () => ({}))
const getForVariantMock = vi.fn().mockImplementation(async () => ({ global: null, perCase: null }))

vi.mock('../../../../src/renderer/src/composables/useApiService', () => ({
  useApiService: () => ({
    api: {
      annotations: {
        upsertPerCase: upsertPerCaseMock,
        batchGet: batchGetMock,
        getForVariant: getForVariantMock
      }
    },
    isAvailable: { value: true }
  })
}))

import * as composableMod from '../../../../src/renderer/src/composables/useShortlistQuery'
import ShortlistPanel from '../../../../src/renderer/src/components/shortlist/ShortlistPanel.vue'
import { createPinia, setActivePinia } from 'pinia'
import { installCapabilities } from '../../helpers/capabilities'
import { useShortlistRankingDialog } from '../../../../src/renderer/src/composables/useShortlistRankingDialog'
import {
  annotationCache,
  beginAnnotationRequest,
  bumpWriteVersion,
  clearAnnotationCache,
  confirmedBases,
  inFlightMutations,
  isKeyLoading,
  setConfirmedWriteVersion,
  setLoading,
  variantKey
} from '../../../../src/renderer/src/composables/annotation-cache'
import { useAnnotations } from '../../../../src/renderer/src/composables/useAnnotations'
import { AppStateKey } from '../../../../src/renderer/src/composables/useAppState'

// Fresh Pinia per test: ShortlistTable resolves its Links column through the
// external-links store, and the star is role-gated (usePermissions reads the
// capability document).
let pinia: ReturnType<typeof createPinia>
beforeEach(() => {
  pinia = createPinia()
  setActivePinia(pinia)
  installCapabilities()
  clearAnnotationCache()
  batchGetMock.mockReset().mockResolvedValue({})
  getForVariantMock.mockReset().mockResolvedValue({ global: null, perCase: null })
})

const state = (
  composableMod as unknown as { __state: ReturnType<typeof composableMod.useShortlistQuery> }
).__state

const vuetify = createVuetify({ components, directives })

/** Minimal ShortlistRow shape — each test overrides the fields it actually
 *  asserts on. Cast to `ShortlistRow` is fine here: the panel only reads
 *  `id`, `case_id`, `is_starred`, and forwards the row via emit. */
function minimalRow(overrides: Partial<ShortlistRow> = {}): ShortlistRow {
  return {
    id: 1,
    case_id: 1,
    variant_type: 'snv',
    chr: '1',
    pos: 1000,
    ref: 'A',
    alt: 'T',
    gene_symbol: 'BRCA1',
    is_starred: false,
    rank: 1,
    rank_score: 0.9,
    rank_components: {
      impact: 1,
      pathogenicity: 0.8,
      rarity: 0.99,
      clinvar: 1,
      phenotype: 0
    },
    rank_clinvar_pinned: false,
    rank_starred_pinned: false,
    ...overrides
  } as ShortlistRow
}

function resetState(): void {
  state.loading.value = false
  state.error.value = null
  state.result.value = null
  state.selectedPresetId.value = 1
  state.shortlistPresets.value = [{ id: 1, name: 'Tier 1 candidates' } as FilterPreset]
  state.presetsLoading.value = false
  ;(state.refresh as ReturnType<typeof vi.fn>).mockClear()
  upsertPerCaseMock.mockClear()
}

describe('ShortlistPanel', () => {
  beforeEach(() => {
    resetState()
  })

  function mountPanel(
    props: { caseId: number } = { caseId: 1 },
    provide?: Record<string | symbol, unknown>
  ) {
    return mount(ShortlistPanel, {
      props,
      global: { plugins: [vuetify, pinia], provide }
    })
  }

  it('opens the ranking settings on the selected preset', async () => {
    const wrapper = mountPanel({ caseId: 1 })
    await wrapper.find('[data-testid="shortlist-edit-ranking"]').trigger('click')
    expect(useShortlistRankingDialog().state).toEqual({ open: true, presetId: 1 })
  })

  it('shows the skeleton before the first query has started (no empty-body frame)', () => {
    state.loading.value = false
    state.result.value = null
    const wrapper = mountPanel({ caseId: 1 })
    expect(wrapper.find('[data-testid="shortlist-loading"]').exists()).toBe(true)
  })

  it('keeps the summary slot rendered before a result so the header height is fixed', () => {
    const wrapper = mountPanel({ caseId: 1 })
    expect(wrapper.find('.shortlist-panel__summary').exists()).toBe(true)
  })

  it('renders loading skeleton when loading=true', () => {
    state.loading.value = true
    state.result.value = null
    const wrapper = mountPanel({ caseId: 1 })
    expect(wrapper.find('[data-testid="shortlist-loading"]').exists()).toBe(true)
  })

  it('renders error alert when error is set', () => {
    state.loading.value = false
    state.error.value = new Error('boom')
    const wrapper = mountPanel({ caseId: 1 })
    expect(wrapper.text()).toContain('boom')
  })

  it('renders empty state when result.rows is empty', () => {
    state.result.value = {
      rows: [],
      totalCandidates: 0,
      presetUsed: null,
      elapsedMs: 10
    }
    const wrapper = mountPanel({ caseId: 1 })
    expect(wrapper.text()).toContain('No variants matched')
  })

  it('renders ShortlistTable when rows are present', () => {
    state.result.value = {
      rows: [minimalRow()],
      totalCandidates: 10,
      presetUsed: null,
      elapsedMs: 10
    }
    const wrapper = mountPanel({ caseId: 1 })
    expect(wrapper.findComponent({ name: 'ShortlistTable' }).exists()).toBe(true)
  })

  it('keeps the current rows visible (no skeleton) while a refresh is loading', () => {
    state.result.value = {
      rows: [minimalRow()],
      totalCandidates: 10,
      presetUsed: null,
      elapsedMs: 10
    }
    state.loading.value = true
    const wrapper = mountPanel({ caseId: 1 })
    expect(wrapper.find('[data-testid="shortlist-loading"]').exists()).toBe(false)
    expect(wrapper.findComponent({ name: 'ShortlistTable' }).exists()).toBe(true)
    expect(wrapper.find('.shortlist-panel__body').attributes('aria-busy')).toBe('true')
  })

  it('emits row-click when ShortlistTable emits row-click', async () => {
    state.result.value = {
      rows: [minimalRow()],
      totalCandidates: 1,
      presetUsed: null,
      elapsedMs: 10
    }
    const wrapper = mountPanel({ caseId: 1 })
    const table = wrapper.findComponent({ name: 'ShortlistTable' })
    await table.vm.$emit('row-click', minimalRow())
    expect(wrapper.emitted('row-click')).toBeTruthy()
  })

  it('emits open-in-tab when ShortlistTable emits open-in-tab', async () => {
    state.result.value = {
      rows: [minimalRow()],
      totalCandidates: 1,
      presetUsed: null,
      elapsedMs: 10
    }
    const wrapper = mountPanel({ caseId: 1 })
    const table = wrapper.findComponent({ name: 'ShortlistTable' })
    await table.vm.$emit('open-in-tab', 'sv')
    expect(wrapper.emitted('open-in-tab')?.[0]?.[0]).toBe('sv')
  })

  it('toggle-star invokes annotations:upsertPerCase via useApiService', async () => {
    const row = minimalRow({ id: 42, case_id: 7, is_starred: false })
    state.result.value = {
      rows: [row],
      totalCandidates: 1,
      presetUsed: null,
      elapsedMs: 10
    }
    const wrapper = mountPanel({ caseId: 7 })
    const table = wrapper.findComponent({ name: 'ShortlistTable' })
    await table.vm.$emit('toggle-star', row)
    await flushPromises()
    expect(upsertPerCaseMock).toHaveBeenCalledWith(7, 42, { starred: true })
  })

  it('toggle-star updates annotationCache for the row (#684)', async () => {
    const row = minimalRow({ id: 42, case_id: 7, is_starred: false })
    state.result.value = {
      rows: [row],
      totalCandidates: 1,
      presetUsed: null,
      elapsedMs: 10
    }
    const wrapper = mountPanel({ caseId: 7 })
    const table = wrapper.findComponent({ name: 'ShortlistTable' })
    const key = variantKey(row)
    expect(annotationCache.value.has(key)).toBe(false)

    await table.vm.$emit('toggle-star', row)
    await flushPromises()

    const cached = annotationCache.value.get(key)
    expect(cached).toBeDefined()
    expect(cached?.perCase?.starred).toBe(1)
  })

  it('toggle-star unstars and updates annotationCache (#684)', async () => {
    const row = minimalRow({ id: 42, case_id: 7, is_starred: true })
    state.result.value = {
      rows: [row],
      totalCandidates: 1,
      presetUsed: null,
      elapsedMs: 10
    }
    const wrapper = mountPanel({ caseId: 7 })
    const table = wrapper.findComponent({ name: 'ShortlistTable' })
    const key = variantKey(row)

    await table.vm.$emit('toggle-star', row)
    await flushPromises()

    const cached = annotationCache.value.get(key)
    expect(cached).toBeDefined()
    expect(cached?.perCase?.starred).toBe(0)
  })

  it('toggle-star restores isKeyLoading if load was in flight', async () => {
    const row = minimalRow({ id: 42, case_id: 7, is_starred: false })
    state.result.value = {
      rows: [row],
      totalCandidates: 1,
      presetUsed: null,
      elapsedMs: 10
    }
    const wrapper = mountPanel({ caseId: 7 })
    const table = wrapper.findComponent({ name: 'ShortlistTable' })
    const key = variantKey(row)
    setLoading(key, true, 'case')

    await table.vm.$emit('toggle-star', row)
    await flushPromises()

    expect(isKeyLoading(key)).toBe(true)
    setLoading(key, false)
  })

  it('toggle-star discards cache write if build switched during write', async () => {
    const row = minimalRow({ id: 42, case_id: 7, is_starred: false })
    state.result.value = {
      rows: [row],
      totalCandidates: 1,
      presetUsed: null,
      elapsedMs: 10
    }
    const wrapper = mountPanel({ caseId: 7 })
    const table = wrapper.findComponent({ name: 'ShortlistTable' })
    const key = variantKey(row)

    let resolveUpsert!: (val: unknown) => void
    upsertPerCaseMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveUpsert = resolve
        })
    )

    await table.vm.$emit('toggle-star', row)
    beginAnnotationRequest(7, 'GRCh38')
    resolveUpsert({
      id: 1,
      case_id: 7,
      variant_id: 42,
      starred: 1
    })
    await flushPromises()

    expect(annotationCache.value.has(key)).toBe(false)
  })

  it('toggle-star does NOT call refresh (relies on broadcast)', async () => {
    const row = minimalRow({ id: 1, case_id: 1, is_starred: true })
    state.result.value = {
      rows: [row],
      totalCandidates: 1,
      presetUsed: null,
      elapsedMs: 10
    }
    const wrapper = mountPanel({ caseId: 1 })
    const table = wrapper.findComponent({ name: 'ShortlistTable' })
    await table.vm.$emit('toggle-star', row)
    await flushPromises()
    expect(state.refresh).not.toHaveBeenCalled()
  })

  it('renders preset picker with shortlistPresets', () => {
    state.shortlistPresets.value = [
      { id: 1, name: 'Tier 1 candidates' } as FilterPreset,
      { id: 2, name: 'Tier 2 candidates' } as FilterPreset
    ]
    const wrapper = mountPanel({ caseId: 1 })
    // v-select renders its selected item inline in the activator, so the
    // currently-selected preset name must appear in the rendered text.
    expect(wrapper.text()).toContain('Tier 1 candidates')
  })

  it('renders empty-presets state instead of infinite skeleton when presets are empty (#663)', async () => {
    state.shortlistPresets.value = []
    state.selectedPresetId.value = null
    state.result.value = null
    state.loading.value = false
    state.error.value = null
    state.presetsLoading.value = false

    const wrapper = mountPanel({ caseId: 1 })
    await flushPromises()

    expect(wrapper.find('[data-testid="shortlist-loading"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="shortlist-empty-presets"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('No shortlist presets available')

    // Clicking Refresh does not get stuck in skeleton
    const refreshBtn = wrapper.findAll('button').find((b) => b.text().includes('Refresh'))
    await refreshBtn?.trigger('click')
    expect(state.refresh).toHaveBeenCalled()
    expect(wrapper.find('[data-testid="shortlist-loading"]').exists()).toBe(false)
  })

  it('prepareRowDialog evicts sibling row 999 cached when opening dialog for row 101', async () => {
    const row101 = minimalRow({
      id: 101,
      case_id: 7,
      chr: 'chr1',
      pos: 100,
      ref: 'A',
      alt: 'G'
    })
    state.result.value = {
      rows: [row101],
      totalCandidates: 1,
      presetUsed: null,
      elapsedMs: 10
    }
    const key = variantKey(row101)

    batchGetMock.mockResolvedValue({
      [key]: {
        global: null,
        perCase: {
          id: 100,
          case_id: 7,
          variant_id: 101,
          starred: 1,
          acmg_classification: 'Pathogenic',
          acmg_evidence: null,
          per_case_comment: 'correct note',
          created_at: 0,
          updated_at: 0
        }
      }
    })

    const wrapper = mountPanel({ caseId: 7 })
    await flushPromises()

    // Sibling row 999 is cached at the same key
    annotationCache.value.set(key, {
      global: null,
      perCase: {
        id: 99,
        case_id: 7,
        variant_id: 999,
        starred: 0,
        acmg_classification: 'Benign',
        acmg_evidence: null,
        per_case_comment: 'sibling note',
        created_at: 0,
        updated_at: 0
      }
    })

    const table = wrapper.findComponent({ name: 'ShortlistTable' })

    await table.vm.$emit('acmg-click', row101)
    await flushPromises()

    const cached = annotationCache.value.get(key)
    expect(cached?.perCase?.variant_id).toBe(101)
    expect(cached?.perCase?.acmg_classification).toBe('Pathogenic')
  })

  it('single-row loadAnnotations in flight when onToggleStar completes does not stall loading flag and does not overwrite star', async () => {
    const row = minimalRow({ id: 42, case_id: 7, is_starred: false })
    state.result.value = {
      rows: [row],
      totalCandidates: 1,
      presetUsed: null,
      elapsedMs: 10
    }
    const wrapper = mountPanel({ caseId: 7 })
    await flushPromises()
    const table = wrapper.findComponent({ name: 'ShortlistTable' })
    const key = variantKey(row)

    let resolveSingleLoad!: (val: unknown) => void
    const singleLoadPromise = new Promise((resolve) => {
      resolveSingleLoad = resolve
    })

    const annotations = useAnnotations()
    getForVariantMock.mockReturnValue(singleLoadPromise)

    // 1. Start single-row load in flight
    const pendingLoad = annotations.loadAnnotations(7, row.chr, row.pos, row.ref, row.alt)
    expect(isKeyLoading(key)).toBe(true)

    // 2. While single-row load is in flight, toggle-star completes
    await table.vm.$emit('toggle-star', row)
    await flushPromises()

    // Key must still be loading because single-row load is pending
    expect(isKeyLoading(key)).toBe(true)
    expect(annotationCache.value.get(key)?.perCase?.starred).toBe(1)

    // 3. Single-row load resolves with stale unstarred data
    resolveSingleLoad({
      global: null,
      perCase: {
        id: 1,
        case_id: 7,
        variant_id: 42,
        starred: 0,
        per_case_comment: null,
        acmg_classification: null,
        acmg_evidence: null,
        created_at: 0,
        updated_at: 0
      }
    })
    await pendingLoad
    await flushPromises()

    // Must NOT stall: loading flag must be cleared
    expect(isKeyLoading(key)).toBe(false)
    // Starred value must NOT be overwritten by the stale single load
    expect(annotationCache.value.get(key)?.perCase?.starred).toBe(1)
  })

  it('out-of-order star/unstar completion in ShortlistPanel preserves newer unstar result', async () => {
    const row = minimalRow({ id: 42, case_id: 7, is_starred: false })
    state.result.value = {
      rows: [row],
      totalCandidates: 1,
      presetUsed: null,
      elapsedMs: 10
    }
    const wrapper = mountPanel({ caseId: 7 })
    const table = wrapper.findComponent({ name: 'ShortlistTable' })
    const key = variantKey(row)

    let resolveStar!: (val: unknown) => void
    const starPromise = new Promise((resolve) => {
      resolveStar = resolve
    })
    let resolveUnstar!: (val: unknown) => void
    const unstarPromise = new Promise((resolve) => {
      resolveUnstar = resolve
    })

    upsertPerCaseMock
      .mockImplementationOnce(() => starPromise)
      .mockImplementationOnce(() => unstarPromise)

    // 1. First click: star (requests starred = true)
    await table.vm.$emit('toggle-star', row)

    // 2. Second click: unstar (requests starred = false)
    await table.vm.$emit('toggle-star', row)

    // 3. Second request (unstar) resolves first
    resolveUnstar({
      id: 2,
      case_id: 7,
      variant_id: 42,
      starred: 0,
      per_case_comment: null,
      acmg_classification: null,
      acmg_evidence: null,
      created_at: 0,
      updated_at: 0
    })
    await flushPromises()
    expect(annotationCache.value.get(key)?.perCase?.starred).toBe(0)

    // 4. First request (star) resolves late
    resolveStar({
      id: 1,
      case_id: 7,
      variant_id: 42,
      starred: 1,
      per_case_comment: null,
      acmg_classification: null,
      acmg_evidence: null,
      created_at: 0,
      updated_at: 0
    })
    await flushPromises()

    // Cache must NOT be overwritten by the older star response
    expect(annotationCache.value.get(key)?.perCase?.starred).toBe(0)
  })

  it('prepareRowDialog shows error snackbar and refuses to open dialog if row annotations cannot be verified', async () => {
    const row = minimalRow({ id: 101, case_id: 7, is_starred: true })
    state.result.value = {
      rows: [row],
      totalCandidates: 1,
      presetUsed: null,
      elapsedMs: 10
    }
    batchGetMock.mockRejectedValueOnce(new Error('Network error'))

    const showSnackSpy = vi.fn()
    const wrapper = mountPanel(
      { caseId: 7 },
      { [AppStateKey as symbol]: { showSnack: showSnackSpy, selectedPanelVariant: ref(null) } }
    )
    await flushPromises()

    const dialogs = wrapper.findComponent({ name: 'AnnotationDialogs' })
    const openSpy = vi.spyOn(dialogs.vm, 'openAcmgEvidenceDialog')

    const table = wrapper.findComponent({ name: 'ShortlistTable' })
    await table.vm.$emit('acmg-click', row)
    await flushPromises()

    expect(showSnackSpy).toHaveBeenCalledWith('Failed to load variant annotations.', 'error')
    expect(openSpy).not.toHaveBeenCalled()
  })

  it('bulk triage bumping star write version cancels in-flight single toggle and allows next toggle from actual state', async () => {
    const row = minimalRow({ id: 42, case_id: 7, is_starred: false })
    state.result.value = {
      rows: [row],
      totalCandidates: 1,
      presetUsed: null,
      elapsedMs: 10
    }
    const wrapper = mountPanel({ caseId: 7 })
    await flushPromises()
    const table = wrapper.findComponent({ name: 'ShortlistTable' })
    const key = variantKey(row)

    let resolveSingleStar!: (val: unknown) => void
    const singleStarPromise = new Promise((resolve) => {
      resolveSingleStar = resolve
    })
    upsertPerCaseMock.mockImplementationOnce(() => singleStarPromise)

    // 1. Single toggle clicked (pending star in flight)
    await table.vm.$emit('toggle-star', row)

    // 2. Bulk triage runs while single toggle is in flight, bumping and confirming write version
    const bulkVer = bumpWriteVersion(key, 'perCase:star')
    setConfirmedWriteVersion(key, 'perCase:star', bulkVer)

    // 3. Single toggle resolves
    resolveSingleStar({
      id: 1,
      case_id: 7,
      variant_id: 42,
      starred: 1,
      per_case_comment: null,
      acmg_classification: null,
      acmg_evidence: null,
      created_at: 0,
      updated_at: 0
    })
    await flushPromises()

    // 4. Next toggle click should not use stale inverted target
    upsertPerCaseMock.mockImplementationOnce(async () => ({
      id: 2,
      case_id: 7,
      variant_id: 42,
      starred: 1,
      per_case_comment: null,
      acmg_classification: null,
      acmg_evidence: null,
      created_at: 0,
      updated_at: 0
    }))
    await table.vm.$emit('toggle-star', row)
    await flushPromises()

    // It requested starred = true based on actual state, not stale inverted pending
    expect(upsertPerCaseMock).toHaveBeenLastCalledWith(7, 42, { starred: true })
  })

  it('prunes superseded in-flight star mutation on successful toggle-star in ShortlistPanel', async () => {
    const row = minimalRow({ id: 42, case_id: 7, is_starred: false })
    state.result.value = {
      rows: [row],
      totalCandidates: 1,
      presetUsed: null,
      elapsedMs: 10
    }
    const wrapper = mountPanel({ caseId: 7 })
    await flushPromises()
    const table = wrapper.findComponent({ name: 'ShortlistTable' })
    const key = variantKey(row)
    const slotKey = `perCase:${key}`

    // Seed an in-flight star mutation from an earlier toggle (writeVer 1)
    const writeVer1 = bumpWriteVersion(key, 'perCase:star')
    inFlightMutations.set(slotKey, [
      { id: 99, fieldGroup: 'star', writeVer: writeVer1, patch: { starred: 1 } }
    ])
    confirmedBases.set(slotKey, { starred: 0 } as never)

    let resolveStar!: (val: unknown) => void
    upsertPerCaseMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveStar = resolve
        })
    )

    // Trigger toggle from ShortlistPanel (writeVer > writeVer1)
    await table.vm.$emit('toggle-star', row)
    expect(inFlightMutations.get(slotKey)?.length).toBe(1)

    // Toggle resolves
    resolveStar({
      id: 1,
      case_id: 7,
      variant_id: 42,
      starred: 1,
      per_case_comment: null,
      acmg_classification: null,
      acmg_evidence: null,
      created_at: 0,
      updated_at: 0
    })
    await flushPromises()

    // The superseded in-flight mutation is pruned and confirmedBases deleted
    expect(inFlightMutations.has(slotKey)).toBe(false)
    expect(confirmedBases.has(slotKey)).toBe(false)
    expect(annotationCache.value.get(key)?.perCase?.starred).toBe(1)
  })
})
