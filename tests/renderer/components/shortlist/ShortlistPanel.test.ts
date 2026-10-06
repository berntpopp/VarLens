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
const upsertPerCaseMock = vi.fn().mockResolvedValue({})
vi.mock('../../../../src/renderer/src/composables/useApiService', () => ({
  useApiService: () => ({
    api: {
      annotations: {
        upsertPerCase: upsertPerCaseMock
      }
    },
    isAvailable: { value: true }
  })
}))

import * as composableMod from '../../../../src/renderer/src/composables/useShortlistQuery'
import ShortlistPanel from '../../../../src/renderer/src/components/shortlist/ShortlistPanel.vue'
import { installCapabilities } from '../../helpers/capabilities'

// The star is role-gated (usePermissions reads the capability document).
beforeEach(() => installCapabilities())

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
  ;(state.refresh as ReturnType<typeof vi.fn>).mockClear()
  upsertPerCaseMock.mockClear()
}

describe('ShortlistPanel', () => {
  beforeEach(() => {
    resetState()
  })

  it('renders loading skeleton when loading=true', () => {
    state.loading.value = true
    state.result.value = null
    const wrapper = mount(ShortlistPanel, {
      props: { caseId: 1 },
      global: { plugins: [vuetify] }
    })
    expect(wrapper.find('[data-testid="shortlist-loading"]').exists()).toBe(true)
  })

  it('renders error alert when error is set', () => {
    state.loading.value = false
    state.error.value = new Error('boom')
    const wrapper = mount(ShortlistPanel, {
      props: { caseId: 1 },
      global: { plugins: [vuetify] }
    })
    expect(wrapper.text()).toContain('boom')
  })

  it('renders empty state when result.rows is empty', () => {
    state.result.value = {
      rows: [],
      totalCandidates: 0,
      presetUsed: null,
      elapsedMs: 10
    }
    const wrapper = mount(ShortlistPanel, {
      props: { caseId: 1 },
      global: { plugins: [vuetify] }
    })
    expect(wrapper.text()).toContain('No variants matched')
  })

  it('renders ShortlistTable when rows are present', () => {
    state.result.value = {
      rows: [minimalRow()],
      totalCandidates: 10,
      presetUsed: null,
      elapsedMs: 10
    }
    const wrapper = mount(ShortlistPanel, {
      props: { caseId: 1 },
      global: { plugins: [vuetify] }
    })
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
    const wrapper = mount(ShortlistPanel, {
      props: { caseId: 1 },
      global: { plugins: [vuetify] }
    })
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
    const wrapper = mount(ShortlistPanel, {
      props: { caseId: 1 },
      global: { plugins: [vuetify] }
    })
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
    const wrapper = mount(ShortlistPanel, {
      props: { caseId: 1 },
      global: { plugins: [vuetify] }
    })
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
    const wrapper = mount(ShortlistPanel, {
      props: { caseId: 7 },
      global: { plugins: [vuetify] }
    })
    const table = wrapper.findComponent({ name: 'ShortlistTable' })
    await table.vm.$emit('toggle-star', row)
    await flushPromises()
    expect(upsertPerCaseMock).toHaveBeenCalledWith(7, 42, { starred: true })
  })

  it('toggle-star does NOT call refresh (relies on broadcast)', async () => {
    const row = minimalRow({ id: 1, case_id: 1, is_starred: true })
    state.result.value = {
      rows: [row],
      totalCandidates: 1,
      presetUsed: null,
      elapsedMs: 10
    }
    const wrapper = mount(ShortlistPanel, {
      props: { caseId: 1 },
      global: { plugins: [vuetify] }
    })
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
    const wrapper = mount(ShortlistPanel, {
      props: { caseId: 1 },
      global: { plugins: [vuetify] }
    })
    // v-select renders its selected item inline in the activator, so the
    // currently-selected preset name must appear in the rendered text.
    expect(wrapper.text()).toContain('Tier 1 candidates')
  })
})
