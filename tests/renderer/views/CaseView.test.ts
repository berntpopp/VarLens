/**
 * Unit tests for `CaseView.vue` — the case-view tab integration that
 * hosts the Wave 6 Shortlist tab alongside the per-type variant tabs.
 *
 * These tests drive `tabItems`, `selectedVariantType` default-selection,
 * `variantTableType` computed, and the template bindings (`:interactive`,
 * `v-show` / `v-if` split). The heavy child components (FilterToolbar,
 * VariantTable, ShortlistPanel) are stubbed so we can introspect the
 * props CaseView binds to them without paying the cost of their real
 * setup pipelines.
 *
 * Spec: .planning/specs/2026-04-11-unified-shortlist-ranked-view-design.md (§6)
 * Plan: .planning/plans/2026-04-11-unified-shortlist-plan.md (Task 6)
 */
/* eslint-disable vue/one-component-per-file -- test file defines three
   stub components (FilterToolbar, VariantTable, ShortlistPanel) inline
   via `vi.mock` factories; the rule doesn't make sense for test doubles. */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, ref, nextTick } from 'vue'
import { createVuetify } from 'vuetify'
import { setActivePinia, createPinia } from 'pinia'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'

// ─── Mock useApiService (typeCounts IPC surface used by loadTypeCounts) ──
const typeCountsMock = vi.fn<[number], Promise<Record<string, number>>>()
vi.mock('../../../src/renderer/src/composables/useApiService', () => ({
  useApiService: () => ({
    api: {
      variants: {
        typeCounts: (caseId: number) => typeCountsMock(caseId)
      }
    },
    isAvailable: { value: true }
  })
}))

// ─── Mock heavy child components so CaseView mounts without their deps ──
//
// FilterToolbar + VariantTable + ShortlistPanel each import their own
// forest of composables. We stub them to tiny components that capture
// their props (via vm.$props) so we can assert on the bindings CaseView
// drives into them.
vi.mock('../../../src/renderer/src/components/FilterToolbar.vue', () => ({
  default: defineComponent({
    name: 'FilterToolbarStub',
    props: {
      caseId: { type: Number, default: null },
      caseName: { type: String, default: '' },
      filteredCount: { type: Number, default: 0 },
      totalCount: { type: Number, default: 0 },
      hasSort: { type: Boolean, default: false },
      columns: { type: Array, default: () => [] },
      columnActiveFilters: { type: Array, default: () => [] }
    },
    emits: [
      'update:filters',
      'reset-sort',
      'export-success',
      'export-error',
      'clear-column-filters',
      'clear-column-filter'
    ],
    setup(_, { expose }) {
      expose({
        filterOptions: { columnMeta: [] },
        handleClearAll: vi.fn()
      })
      return () => h('div', { class: 'filter-toolbar-stub' })
    }
  })
}))

vi.mock('../../../src/renderer/src/components/VariantTable.vue', () => ({
  default: defineComponent({
    name: 'VariantTableStub',
    props: {
      caseId: { type: Number, default: null },
      filters: { type: Object, default: () => ({}) },
      annotationScope: { type: String, default: 'case' },
      columnMeta: { type: Array, default: () => [] },
      variantType: { type: String, default: 'snv' },
      interactive: { type: Boolean, default: true }
    },
    emits: ['update:counts', 'update:hasSort', 'row-click', 'deselect', 'clear-filters'],
    setup(_, { expose }) {
      expose({
        resetSort: vi.fn(),
        refresh: vi.fn(),
        columns: [],
        hasColumnFilters: ref(false),
        columnFilterCount: ref(0),
        clearAllColumnFilters: vi.fn(),
        clearColumnFilter: vi.fn(),
        columnActiveFilters: ref([])
      })
      return () => h('div', { class: 'variant-table-stub' })
    }
  })
}))

vi.mock('../../../src/renderer/src/components/shortlist/ShortlistPanel.vue', () => ({
  default: defineComponent({
    name: 'ShortlistPanelStub',
    props: {
      caseId: { type: Number, default: null }
    },
    emits: ['row-click', 'open-in-tab'],
    setup() {
      return () => h('div', { class: 'shortlist-panel-stub' })
    }
  })
}))

// ─── Minimal global fetch / LogService mocks ────────────────────────────
vi.mock('../../../src/renderer/src/services/LogService', () => ({
  logService: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn()
  }
}))

// Import AFTER mocks so the hoisted `vi.mock` factories take effect.
import CaseView from '../../../src/renderer/src/views/CaseView.vue'
import { AppStateKey, createAppState } from '../../../src/renderer/src/composables/useAppState'
import { installCapabilities } from '../helpers/capabilities'

const vuetify = createVuetify({ components, directives })

/**
 * Mount CaseView with a fresh AppState provide. Returns the wrapper and
 * the provided state so tests can drive `selectedCaseId` and observe
 * downstream effects.
 */
function mountCaseView(initialCaseId: number | null = 1) {
  const state = createAppState()
  state.selectedCaseId.value = initialCaseId
  const wrapper = mount(CaseView, {
    global: {
      plugins: [vuetify],
      provide: {
        [AppStateKey as symbol]: state
      }
    }
  })
  return { wrapper, state }
}

describe('CaseView — Shortlist tab integration', () => {
  beforeEach(() => {
    typeCountsMock.mockReset()
    // `useSettingsStore` persists to localStorage — clear it between
    // tests so the `defaultCaseTab` preference set by one test does
    // not leak into the next via localStorage → load() on fresh Pinia
    // creation.
    localStorage.clear()
    // CaseView now consumes `useSettingsStore` (Pinia) for the
    // `defaultCaseTab` preference — tests need a fresh active Pinia.
    setActivePinia(createPinia())
  })

  it('shows Shortlist tab even on single-type cases (algorithmic ranking view)', async () => {
    typeCountsMock.mockResolvedValue({ snv: 10, sv: 0, cnv: 0, str: 0 })
    const { wrapper } = mountCaseView(1)
    await flushPromises()
    // Shortlist has two reasons to exist — cross-type comparison AND
    // algorithmic ranking. Reason (2) applies even on SNV-only cases.
    expect(wrapper.text()).toContain('Shortlist')
  })

  it('shows Shortlist tab when more than one variant type is present', async () => {
    typeCountsMock.mockResolvedValue({ snv: 10, sv: 3, cnv: 0, str: 0 })
    const { wrapper } = mountCaseView(1)
    await flushPromises()
    expect(wrapper.text()).toContain('Shortlist')
  })

  it('defaults selectedVariantType to "shortlist" on any non-empty case', async () => {
    typeCountsMock.mockResolvedValue({ snv: 10, sv: 3 })
    const { wrapper } = mountCaseView(1)
    await flushPromises()
    expect((wrapper.vm as unknown as { selectedVariantType: string }).selectedVariantType).toBe(
      'shortlist'
    )
  })

  it('seeds lastNonShortlistType to first present type on cnv+str case', async () => {
    typeCountsMock.mockResolvedValue({ snv: 0, indel: 0, sv: 0, cnv: 2, str: 1 })
    const { wrapper } = mountCaseView(1)
    await flushPromises()
    const vm = wrapper.vm as unknown as {
      selectedVariantType: string
      lastNonShortlistType: string
    }
    expect(vm.selectedVariantType).toBe('shortlist')
    expect(vm.lastNonShortlistType).toBe('cnv')
  })

  it('lands on Shortlist with lastNonShortlistType seeded for a single-type SV-only case', async () => {
    typeCountsMock.mockResolvedValue({ snv: 0, sv: 5, cnv: 0, str: 0 })
    const { wrapper } = mountCaseView(1)
    await flushPromises()
    const vm = wrapper.vm as unknown as {
      selectedVariantType: string
      lastNonShortlistType: string
    }
    expect(vm.selectedVariantType).toBe('shortlist')
    expect(vm.lastNonShortlistType).toBe('sv')
  })

  it('honors settings.defaultCaseTab = "snv" by landing on the first per-type tab', async () => {
    // User preference via gear-menu → Application Preferences → Case View
    // → Default active tab → "SNV/Indel (per-type table)".
    const { useSettingsStore } = await import('../../../src/renderer/src/stores/settingsStore')
    const settings = useSettingsStore()
    settings.defaultCaseTab = 'snv'

    typeCountsMock.mockResolvedValue({ snv: 10, sv: 3 })
    const { wrapper } = mountCaseView(1)
    await flushPromises()
    const vm = wrapper.vm as unknown as {
      selectedVariantType: string
      lastNonShortlistType: string
    }
    // Preference says "per-type first" → lands on the first present type.
    expect(vm.selectedVariantType).toBe('snv')
    // `lastNonShortlistType` still seeds to the first present type so
    // toggling between Shortlist and per-type works without a stale bind.
    expect(vm.lastNonShortlistType).toBe('snv')
  })

  it('honors settings.defaultCaseTab = "snv" on an SV-only case by landing on SV', async () => {
    // SV-only case, preference is "per-type first" → lands on SV (the
    // first present type) rather than Shortlist.
    const { useSettingsStore } = await import('../../../src/renderer/src/stores/settingsStore')
    const settings = useSettingsStore()
    settings.defaultCaseTab = 'snv'

    typeCountsMock.mockResolvedValue({ snv: 0, sv: 5, cnv: 0, str: 0 })
    const { wrapper } = mountCaseView(1)
    await flushPromises()
    const vm = wrapper.vm as unknown as {
      selectedVariantType: string
      lastNonShortlistType: string
    }
    expect(vm.selectedVariantType).toBe('sv')
    expect(vm.lastNonShortlistType).toBe('sv')
  })

  it('variantTableType computed never yields "shortlist" when Shortlist is selected', async () => {
    typeCountsMock.mockResolvedValue({ snv: 10, sv: 3 })
    const { wrapper } = mountCaseView(1)
    await flushPromises()
    const vm = wrapper.vm as unknown as {
      selectedVariantType: string
      variantTableType: string
    }
    expect(vm.selectedVariantType).toBe('shortlist')
    expect(vm.variantTableType).not.toBe('shortlist')
    expect(['snv', 'sv', 'cnv', 'str']).toContain(vm.variantTableType)
  })

  it('watcher stashes last non-shortlist tab when user picks sv', async () => {
    typeCountsMock.mockResolvedValue({ snv: 10, sv: 3 })
    const { wrapper } = mountCaseView(1)
    await flushPromises()
    const table = wrapper.findComponent({ name: 'VariantTableStub' })
    // Drive the selection by emitting from the v-tabs v-model, which is
    // the user-visible surface. Writing to the exposed ref via the proxy
    // is unreliable across @vue/test-utils versions.
    const tabs = wrapper.findComponent({ name: 'VTabs' })
    await tabs.vm.$emit('update:modelValue', 'sv')
    await flushPromises()
    expect(table.props('variantType')).toBe('sv')
    expect((wrapper.vm as unknown as { lastNonShortlistType: string }).lastNonShortlistType).toBe(
      'sv'
    )
    // Toggle back to Shortlist → lastNonShortlistType must still read 'sv'
    await tabs.vm.$emit('update:modelValue', 'shortlist')
    await flushPromises()
    expect((wrapper.vm as unknown as { lastNonShortlistType: string }).lastNonShortlistType).toBe(
      'sv'
    )
  })

  it('binds :interactive=false on VariantTable when Shortlist tab is active', async () => {
    typeCountsMock.mockResolvedValue({ snv: 10, sv: 3 })
    const { wrapper } = mountCaseView(1)
    await flushPromises()
    const table = wrapper.findComponent({ name: 'VariantTableStub' })
    expect(table.exists()).toBe(true)
    expect(table.props('interactive')).toBe(false)
  })

  it('binds :interactive=true on VariantTable when a per-type tab is active', async () => {
    typeCountsMock.mockResolvedValue({ snv: 10, sv: 3 })
    const { wrapper } = mountCaseView(1)
    await flushPromises()
    const vm = wrapper.vm as unknown as { selectedVariantType: string }
    vm.selectedVariantType = 'sv'
    await flushPromises()
    const table = wrapper.findComponent({ name: 'VariantTableStub' })
    expect(table.props('interactive')).toBe(true)
  })

  it('effectiveFilters.variant_type tracks variantTableType (never "shortlist")', async () => {
    typeCountsMock.mockResolvedValue({ snv: 10, sv: 3 })
    const { wrapper } = mountCaseView(1)
    await flushPromises()
    const table = wrapper.findComponent({ name: 'VariantTableStub' })
    const filters = table.props('filters') as { variant_type?: string }
    expect(filters.variant_type).not.toBe('shortlist')
    // Defaults land on Shortlist → lastNonShortlistType is 'snv' (first present)
    expect(filters.variant_type).toBe('snv')
  })

  it('VariantTable stays mounted (via v-show) while Shortlist is active', async () => {
    typeCountsMock.mockResolvedValue({ snv: 10, sv: 3 })
    const { wrapper } = mountCaseView(1)
    await flushPromises()
    const table = wrapper.findComponent({ name: 'VariantTableStub' })
    // Even though the Shortlist tab is active, VariantTable is mounted.
    expect(table.exists()).toBe(true)
  })

  it('ShortlistPanel is mounted on-demand (v-if) when Shortlist tab is active', async () => {
    typeCountsMock.mockResolvedValue({ snv: 10, sv: 3 })
    const { wrapper } = mountCaseView(1)
    await flushPromises()
    expect(wrapper.findComponent({ name: 'ShortlistPanelStub' }).exists()).toBe(true)
  })

  it('ShortlistPanel stays mounted but hidden after the first visit when a per-type tab is active', async () => {
    typeCountsMock.mockResolvedValue({ snv: 10, sv: 3 })
    const { wrapper } = mountCaseView(1)
    await flushPromises()
    const vm = wrapper.vm as unknown as { selectedVariantType: string }
    vm.selectedVariantType = 'sv'
    await flushPromises()
    const panel = wrapper.findComponent({ name: 'ShortlistPanelStub' })
    expect(panel.exists()).toBe(true)
    expect((panel.element as HTMLElement).style.display).toBe('none')
  })

  it('ShortlistPanel is NOT mounted on cases where the Shortlist was never opened', async () => {
    typeCountsMock.mockResolvedValue({ snv: 10, sv: 3 })
    const { useSettingsStore } = await import('../../../src/renderer/src/stores/settingsStore')
    useSettingsStore().defaultCaseTab = 'snv'
    const { wrapper } = mountCaseView(1)
    await flushPromises()
    expect(wrapper.findComponent({ name: 'ShortlistPanelStub' }).exists()).toBe(false)
  })

  it('ShortlistPanel open-in-tab switches selectedVariantType to emitted tab', async () => {
    typeCountsMock.mockResolvedValue({ snv: 10, sv: 3 })
    const { wrapper } = mountCaseView(1)
    await flushPromises()
    const panel = wrapper.findComponent({ name: 'ShortlistPanelStub' })
    await panel.vm.$emit('open-in-tab', 'sv')
    await flushPromises()
    expect((wrapper.vm as unknown as { selectedVariantType: string }).selectedVariantType).toBe(
      'sv'
    )
  })

  it('ShortlistPanel row-click drives selectedPanelVariant via handleRowClick', async () => {
    typeCountsMock.mockResolvedValue({ snv: 10, sv: 3 })
    const { wrapper, state } = mountCaseView(1)
    await flushPromises()
    const panel = wrapper.findComponent({ name: 'ShortlistPanelStub' })
    const row = {
      id: 42,
      case_id: 1,
      chr: '1',
      pos: 100,
      ref: 'A',
      alt: 'T',
      variant_type: 'snv'
    }
    await panel.vm.$emit('row-click', row)
    await flushPromises()
    expect(state.panelOpen.value).toBe(true)
    expect(state.selectedPanelVariant.value).toMatchObject({ id: 42 })
  })

  // ── PR1-12 (A3): FilterToolbar deferred mount ───────────────────
  //
  // Pass-9 #3 — the FilterToolbar must NOT mount (and therefore must
  // not fire its `loadFilterOptions` IPC round-trip) until variant type
  // counts have arrived. The outer per-type region stays on `v-show`
  // (preserving VariantTable selection/scroll), only the FilterToolbar
  // is gated behind `v-if="firstActivated"`.

  it('does NOT mount FilterToolbar before variant type counts load', () => {
    // Pending typeCounts promise — counts have not resolved yet.
    let resolveCounts!: (v: Record<string, number>) => void
    typeCountsMock.mockReturnValue(
      new Promise<Record<string, number>>((resolve) => {
        resolveCounts = resolve
      })
    )
    const { wrapper } = mountCaseView(1)
    // Synchronously after mount, before counts resolve: no FilterToolbar.
    expect(wrapper.findComponent({ name: 'FilterToolbarStub' }).exists()).toBe(false)
    expect((wrapper.vm as unknown as { firstActivated: boolean }).firstActivated).toBe(false)
    // Resolve so we don't leak an unhandled pending promise.
    resolveCounts({ snv: 10, sv: 3 })
  })

  it('mounts FilterToolbar once type counts arrive on a per-type tab', async () => {
    const { useSettingsStore } = await import('../../../src/renderer/src/stores/settingsStore')
    const settings = useSettingsStore()
    settings.defaultCaseTab = 'snv'

    typeCountsMock.mockResolvedValue({ snv: 10, sv: 3 })
    const { wrapper } = mountCaseView(1)
    await flushPromises()
    expect((wrapper.vm as unknown as { firstActivated: boolean }).firstActivated).toBe(true)
    expect(wrapper.findComponent({ name: 'FilterToolbarStub' }).exists()).toBe(true)
  })

  it('keeps FilterToolbar mounted after toggling to Shortlist (firstActivated never resets)', async () => {
    const { useSettingsStore } = await import('../../../src/renderer/src/stores/settingsStore')
    const settings = useSettingsStore()
    settings.defaultCaseTab = 'snv'

    typeCountsMock.mockResolvedValue({ snv: 10, sv: 3 })
    const { wrapper } = mountCaseView(1)
    await flushPromises()
    // Activated on the per-type tab.
    expect(wrapper.findComponent({ name: 'FilterToolbarStub' }).exists()).toBe(true)

    // Toggle to Shortlist — firstActivated must stay true, FilterToolbar mounted.
    const tabs = wrapper.findComponent({ name: 'VTabs' })
    await tabs.vm.$emit('update:modelValue', 'shortlist')
    await flushPromises()
    expect((wrapper.vm as unknown as { firstActivated: boolean }).firstActivated).toBe(true)
    expect(wrapper.findComponent({ name: 'FilterToolbarStub' }).exists()).toBe(true)
  })

  it('does not activate FilterToolbar while the case lands on Shortlist (counts loaded, shortlist tab)', async () => {
    // Default preference = shortlist → after counts load the active tab is
    // 'shortlist'. firstActivated must remain false until a per-type tab is
    // shown, so the FilterToolbar IPC is deferred while the user sits on
    // Shortlist.
    typeCountsMock.mockResolvedValue({ snv: 10, sv: 3 })
    const { wrapper } = mountCaseView(1)
    await flushPromises()
    expect((wrapper.vm as unknown as { selectedVariantType: string }).selectedVariantType).toBe(
      'shortlist'
    )
    expect((wrapper.vm as unknown as { firstActivated: boolean }).firstActivated).toBe(false)
    expect(wrapper.findComponent({ name: 'FilterToolbarStub' }).exists()).toBe(false)
  })

  // ── Shortlist flicker on case switch (track 2, 2026-10-06) ─────────
  // The case watcher used to reset the tab to 'snv' until the new case's
  // type counts resolved, so every switch showed Shortlist -> SNV table ->
  // Shortlist and mounted the FilterToolbar.
  it('keeps the Shortlist tab active throughout a case switch (no SNV flash)', async () => {
    typeCountsMock.mockResolvedValue({ snv: 10, sv: 3 })
    const { wrapper, state } = mountCaseView(1)
    await flushPromises()
    const vm = wrapper.vm as unknown as { selectedVariantType: string; firstActivated: boolean }

    const seen: string[] = []
    const stop = wrapper.vm.$watch(
      () => vm.selectedVariantType,
      (tab: string) => seen.push(tab),
      { flush: 'sync' }
    )
    let resolveCounts: (counts: Record<string, number>) => void = () => {}
    typeCountsMock.mockReturnValueOnce(new Promise((resolve) => (resolveCounts = resolve)))
    state.selectedCaseId.value = 2
    await flushPromises()
    expect(vm.selectedVariantType).toBe('shortlist')
    resolveCounts({ snv: 4 })
    await flushPromises()
    stop()

    expect(seen).not.toContain('snv')
    expect(vm.selectedVariantType).toBe('shortlist')
    expect(vm.firstActivated).toBe(false)
    expect(wrapper.findComponent({ name: 'FilterToolbarStub' }).exists()).toBe(false)
  })

  it('falls back to the empty per-type view when the new case has no variants', async () => {
    typeCountsMock.mockResolvedValue({ snv: 10 })
    const { wrapper, state } = mountCaseView(1)
    await flushPromises()
    typeCountsMock.mockResolvedValue({})
    state.selectedCaseId.value = 2
    await flushPromises()
    expect((wrapper.vm as unknown as { selectedVariantType: string }).selectedVariantType).toBe(
      'snv'
    )
  })

  it('does not override a tab the user picked while the counts were loading', async () => {
    typeCountsMock.mockResolvedValue({ snv: 10, sv: 3 })
    const { wrapper, state } = mountCaseView(1)
    await flushPromises()
    let resolveCounts: (counts: Record<string, number>) => void = () => {}
    typeCountsMock.mockReturnValueOnce(new Promise((resolve) => (resolveCounts = resolve)))
    state.selectedCaseId.value = 2
    await flushPromises()
    await wrapper.findComponent({ name: 'VTabs' }).vm.$emit('update:modelValue', 'sv')
    resolveCounts({ snv: 10, sv: 3 })
    await flushPromises()
    expect((wrapper.vm as unknown as { selectedVariantType: string }).selectedVariantType).toBe(
      'sv'
    )
  })

  it('guards loadTypeCounts against out-of-order responses during A -> B case switch (#665)', async () => {
    let resolveCase1!: (counts: Record<string, number>) => void
    let resolveCase2!: (counts: Record<string, number>) => void

    typeCountsMock.mockImplementation((id: number) => {
      if (id === 1) {
        return new Promise((resolve) => {
          resolveCase1 = resolve
        })
      }
      if (id === 2) {
        return new Promise((resolve) => {
          resolveCase2 = resolve
        })
      }
      return Promise.resolve({})
    })

    const { wrapper, state } = mountCaseView(1)
    await nextTick()

    // Switch to case 2 while case 1 is still pending
    state.selectedCaseId.value = 2
    await flushPromises()

    // Case 2 resolves first with SV variants
    resolveCase2({ sv: 5 })
    await flushPromises()

    const vm = wrapper.vm as unknown as {
      typeCounts: Record<string, number>
      selectedVariantType: string
    }
    expect(vm.typeCounts).toEqual({ sv: 5 })

    // Now Case 1 slow response arrives out-of-order
    resolveCase1({ snv: 42 })
    await flushPromises()

    // Stale Case 1 response must NOT overwrite Case 2!
    expect(vm.typeCounts).toEqual({ sv: 5 })
  })

  it('guards loadTypeCounts against out-of-order responses during A -> B -> A case switch (#665)', async () => {
    let resolveCase1a!: (counts: Record<string, number>) => void
    let resolveCase1b!: (counts: Record<string, number>) => void
    let callCount = 0

    typeCountsMock.mockImplementation((id: number) => {
      callCount++
      if (id === 1 && callCount === 1) {
        return new Promise((resolve) => {
          resolveCase1a = resolve
        })
      }
      if (id === 2) {
        return Promise.resolve({ cnv: 1 })
      }
      if (id === 1 && callCount > 2) {
        return new Promise((resolve) => {
          resolveCase1b = resolve
        })
      }
      return Promise.resolve({})
    })

    const { wrapper, state } = mountCaseView(1)
    await nextTick()

    // Switch to case 2
    state.selectedCaseId.value = 2
    await flushPromises()

    // Switch back to case 1
    state.selectedCaseId.value = 1
    await flushPromises()

    // First request 1a resolves late
    resolveCase1a({ snv: 999 })
    await flushPromises()

    const vm = wrapper.vm as unknown as { typeCounts: Record<string, number> }
    // Must NOT accept 1a
    expect(vm.typeCounts).not.toEqual({ snv: 999 })

    // Second request 1b resolves
    resolveCase1b({ snv: 12, sv: 3 })
    await flushPromises()
    expect(vm.typeCounts).toEqual({ snv: 12, sv: 3 })
  })

  it('resets countsLoading to false when switching from in-flight case to null or 0 (#665)', async () => {
    let resolveCase!: (counts: Record<string, number>) => void
    typeCountsMock.mockImplementation(() => {
      return new Promise((resolve) => {
        resolveCase = resolve
      })
    })

    const { wrapper, state } = mountCaseView(1)
    await nextTick()

    const vm = wrapper.vm as unknown as { countsLoading: boolean }
    expect(vm.countsLoading).toBe(true)

    // Clear case selection while request is in-flight
    state.selectedCaseId.value = null
    await flushPromises()

    // countsLoading must reset to false immediately
    expect(vm.countsLoading).toBe(false)

    // Resolve the in-flight request late
    resolveCase({ snv: 5 })
    await flushPromises()
    expect(vm.countsLoading).toBe(false)
  })
})

describe('CaseView — welcome screen import', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  function mountWelcome(role: string) {
    installCapabilities({ role })
    const mounted = mountCaseView(null)
    const openImport = vi.fn()
    mounted.state.setImportHandler(openImport)
    mounted.state.setCaseCount(0)
    return { ...mounted, openImport }
  }

  it('opens the import dialog even when the sidebar is already open', async () => {
    const { wrapper, state, openImport } = mountWelcome('analyst')
    state.sidebarOpen.value = true
    await flushPromises()

    const button = wrapper.findAll('button').find((b) => b.text().includes('Import Variants'))
    expect(button).toBeDefined()
    await button?.trigger('click')

    expect(openImport).toHaveBeenCalledTimes(1)
  })

  it('offers no import button to a read-only viewer', async () => {
    const { wrapper, openImport } = mountWelcome('viewer')
    await flushPromises()

    expect(wrapper.text()).not.toContain('Import Variants')
    expect(wrapper.text()).toContain('No cases are available in this workspace yet.')
    expect(openImport).not.toHaveBeenCalled()
  })
})
