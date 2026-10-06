/**
 * Unit tests for the `VariantTable.interactive` prop — the Wave 6
 * keyboard-gate added so a hidden (via `v-show`) VariantTable does
 * not steal global keystrokes from an adjacent visible panel (e.g.
 * the Shortlist tab in `CaseView.vue`).
 *
 * Strategy: VariantTable imports a lot of heavy composables
 * (`useAnnotations`, `useVariantData`, `useColumnPreferences`, …) whose
 * full setups are out of scope for this prop. We mock each of those to
 * empty shells so the component's `<script setup>` runs end-to-end,
 * then spy on `useTableKeyboardNav`'s returned action functions and
 * mocked `AnnotationDialogs` methods. Every global keystroke the
 * component registers via `onKeyStroke` calls exactly one of these
 * spies, so we can assert the `interactive: false` gate without
 * reasoning about DOM-selection state or paginated data.
 *
 * Spec: .planning/specs/2026-04-11-unified-shortlist-ranked-view-design.md (§6)
 * Plan: .planning/plans/2026-04-11-unified-shortlist-plan.md (Task 6)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { ref, computed } from 'vue'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'

// ─── Shared spies ─────────────────────────────────────────────────────────
//
// These are declared at module scope so `vi.mock` factories can close over
// them. Every spy is `.mockClear()`-ed in `beforeEach`.
const moveDownSpy = vi.fn()
const moveUpSpy = vi.fn()
const clearSelectionSpy = vi.fn()
const handleStarToggleSpy = vi.fn()
const openCommentDialogSpy = vi.fn()
const openAcmgEvidenceDialogSpy = vi.fn()

// A mutable `selectedItem` ref so we can force Enter/s/c/a handlers through
// their "has a selection" branch — those handlers early-return when
// `selectedItem.value === null`.
const fakeSelectedItem = ref<Record<string, unknown> | null>({
  id: 1,
  chr: '1',
  pos: 100,
  ref: 'A',
  alt: 'T'
})

// ─── Composable mocks ─────────────────────────────────────────────────────
//
// `useTableKeyboardNav` is the one we actually care about — the spies on its
// action functions let us assert gate behavior. Everything else returns the
// smallest no-op shape VariantTable needs to finish its setup.

vi.mock('../../../../src/renderer/src/composables/useTableKeyboardNav', async (importOriginal) => ({
  // Real modifier guard: the browser-shortcut tests below exercise it.
  hasCommandModifier: (
    await importOriginal<
      typeof import('../../../../src/renderer/src/composables/useTableKeyboardNav')
    >()
  ).hasCommandModifier,
  useTableKeyboardNav: () => ({
    selectedIndex: ref(0),
    selectedItem: computed(() => fakeSelectedItem.value),
    selectIndex: vi.fn(),
    selectByClick: vi.fn(),
    moveUp: moveUpSpy,
    moveDown: moveDownSpy,
    clearSelection: clearSelectionSpy,
    // Always return `false` so the early-return on "input focused" never
    // short-circuits — we want to measure the `interactive` gate itself.
    isInputFocused: () => false
  }),
  isInputFocused: () => false
}))

vi.mock('../../../../src/renderer/src/composables/useAnnotations', () => ({
  useAnnotations: () => ({
    getAcmgEvidence: vi.fn(),
    toggleStar: vi.fn(),
    setAcmgClassification: vi.fn(),
    setAcmgClassificationWithEvidence: vi.fn(),
    getGlobalComment: vi.fn(),
    getPerCaseComment: vi.fn(),
    upsertGlobalComment: vi.fn(),
    upsertPerCaseComment: vi.fn(),
    getAnnotations: vi.fn(),
    toggleGlobalStar: vi.fn(),
    setGlobalAcmgClassification: vi.fn(),
    setGlobalAcmgClassificationWithEvidence: vi.fn(),
    getGlobalAcmgEvidence: vi.fn(),
    loadAnnotationsBatch: vi.fn(),
    invalidateAnnotationGeneration: vi.fn(),
    clearCache: vi.fn()
  }),
  annotationCache: new Map()
}))

vi.mock('../../../../src/renderer/src/composables/useColumnPreferences', () => ({
  useColumnPreferences: () => ({
    prefs: ref({ order: [], visible: {}, widths: {}, sort: [], pinned: [] })
  })
}))

vi.mock('../../../../src/renderer/src/composables/useVariantLinks', () => ({
  useVariantLinks: () => ({
    linksStore: {
      enabledLinks: [],
      virtualLinks: [],
      genomeBuild: 'GRCh38'
    },
    buildOmimEntryUrl: () => null,
    resolveLink: () => null,
    openExternalLink: vi.fn()
  })
}))

vi.mock('../../../../src/renderer/src/composables/useAutoPageSize', () => ({
  useAutoPageSize: () => ({
    tableItemsPerPage: ref(25),
    pageSizeOptions: computed(() => [25])
  })
}))

vi.mock('../../../../src/renderer/src/composables/useLinkResolvers', () => ({
  useLinkResolvers: () => ({
    resolvers: computed(() => ({})),
    linkOuts: computed(() => [])
  })
}))

vi.mock('../../../../src/renderer/src/components/variant-table/useVariantRowViewModel', () => ({
  useVariantRowViewModel: () => ({
    rowViewModels: computed(() => new Map()),
    getViewModel: () => null
  })
}))

vi.mock('../../../../src/renderer/src/components/variant-table/columns', () => ({
  useVariantColumns: () => ({
    headers: computed(() => []),
    visibleHeaders: computed(() => []),
    filterableColumns: computed(() => [])
  })
}))

vi.mock('../../../../src/renderer/src/components/variant-table/useVariantData', () => ({
  useVariantData: () => ({
    variants: ref([]),
    totalCount: ref(0),
    loading: ref(false),
    page: ref(1),
    itemsPerPage: ref(50),
    sortBy: ref([]),
    itemsPerPageOptions: [50, 100, 200],
    selectedVariantId: ref(null),
    loadVariants: vi.fn(),
    resetSort: vi.fn(),
    getRowProps: () => ({}),
    columnMeta: ref([]),
    hasActiveFilters: computed(() => false),
    activeFilterCount: computed(() => 0),
    setColumnFilter: vi.fn(),
    clearColumnFilter: vi.fn(),
    clearAllColumnFilters: vi.fn(),
    hasFilter: () => false,
    getFilter: () => null,
    getColumnFiltersParam: () => null
  })
}))

vi.mock('../../../../src/renderer/src/composables/useColumnFilterMeta', () => ({
  useColumnFilterMeta: () => ({
    columnMetaMap: computed(() => ({})),
    columnFilterModes: computed(() => ({}))
  })
}))

vi.mock('../../../../src/renderer/src/composables/useTableScroll', () => ({
  useTableScroll: () => ({
    topScrollbarRef: ref(null),
    topScrollbarInnerRef: ref(null),
    initScrollSync: vi.fn()
  })
}))

// Stub the AnnotationDialogs child — the `s`, `c`, `a` handlers dispatch
// through its template ref, so we expose the spied methods on a minimal
// component. Using `defineExpose` so template refs see them.
vi.mock('../../../../src/renderer/src/components/AnnotationDialogs.vue', () => ({
  default: {
    name: 'AnnotationDialogs',
    setup(_props: unknown, { expose }: { expose: (o: Record<string, unknown>) => void }) {
      expose({
        handleStarToggle: handleStarToggleSpy,
        handleQuickAcmgSelect: vi.fn(),
        openAcmgEvidenceDialog: openAcmgEvidenceDialogSpy,
        openCommentDialog: openCommentDialogSpy
      })
      return () => null
    }
  }
}))

// Import AFTER mocks so the hoisted `vi.mock` factories take effect.
import VariantTable from '../../../../src/renderer/src/components/VariantTable.vue'

const vuetify = createVuetify({ components, directives })

// Track every mounted wrapper so `afterEach` can unmount them — without
// this, previous tests' `onKeyStroke` handlers stay registered on
// `window` and leak into the current test's keydown dispatches.
const mountedWrappers: VueWrapper[] = []

function mountTable(props: Record<string, unknown> = {}): VueWrapper {
  const wrapper = mount(VariantTable, {
    props: {
      caseId: 1,
      filters: {},
      variantType: 'snv',
      ...props
    } as never,
    global: {
      plugins: [vuetify],
      stubs: {
        // Stub the heavy data-table so happy-dom doesn't try to render
        // Vuetify's internal grid machinery — we only need the
        // component's `<script setup>` to run so the `onKeyStroke`
        // handlers are registered on `window`.
        VDataTableServer: { template: '<div class="stub-table" />' },
        VariantColumnHeader: true
      }
    }
  })
  mountedWrappers.push(wrapper)
  return wrapper
}

/** Dispatch a real `keydown` on `window` so `onKeyStroke` fires. */
function pressKey(key: string): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
}

describe('VariantTable interactive prop (keyboard gate)', () => {
  beforeEach(() => {
    moveDownSpy.mockClear()
    moveUpSpy.mockClear()
    clearSelectionSpy.mockClear()
    handleStarToggleSpy.mockClear()
    openCommentDialogSpy.mockClear()
    openAcmgEvidenceDialogSpy.mockClear()
    fakeSelectedItem.value = {
      id: 1,
      chr: '1',
      pos: 100,
      ref: 'A',
      alt: 'T'
    }
  })

  afterEach(() => {
    // Unmount every wrapper from this test so its `onKeyStroke`
    // cleanup runs before the next test mounts a fresh instance.
    // Without this, window-scoped keydown listeners leak and previous
    // tests' handlers fire during later tests' dispatches.
    while (mountedWrappers.length > 0) {
      mountedWrappers.pop()?.unmount()
    }
    document.body.innerHTML = ''
  })

  it('default prop is interactive=true (existing behavior preserved)', () => {
    const wrapper = mountTable()
    expect((wrapper.vm.$props as { interactive: boolean }).interactive).toBe(true)
  })

  it('interactive=true: ArrowDown calls moveDown (baseline)', () => {
    mountTable({ interactive: true })
    pressKey('ArrowDown')
    expect(moveDownSpy).toHaveBeenCalledTimes(1)
  })

  it('interactive=false: ArrowDown is suppressed', () => {
    mountTable({ interactive: false })
    pressKey('ArrowDown')
    expect(moveDownSpy).not.toHaveBeenCalled()
  })

  it('interactive=false: ArrowUp is suppressed', () => {
    mountTable({ interactive: false })
    pressKey('ArrowUp')
    expect(moveUpSpy).not.toHaveBeenCalled()
  })

  it('interactive=false: Enter does NOT emit row-click', () => {
    const wrapper = mountTable({ interactive: false })
    pressKey('Enter')
    expect(wrapper.emitted('row-click')).toBeUndefined()
  })

  it('interactive=false: Escape does NOT clear selection or emit deselect', () => {
    const wrapper = mountTable({ interactive: false })
    pressKey('Escape')
    expect(clearSelectionSpy).not.toHaveBeenCalled()
    expect(wrapper.emitted('deselect')).toBeUndefined()
  })

  it('interactive=false: "s" does NOT trigger star toggle', () => {
    mountTable({ interactive: false })
    pressKey('s')
    expect(handleStarToggleSpy).not.toHaveBeenCalled()
  })

  it('interactive=false: "c" does NOT open comment dialog', () => {
    mountTable({ interactive: false })
    pressKey('c')
    expect(openCommentDialogSpy).not.toHaveBeenCalled()
  })

  it('interactive=false: "a" does NOT open ACMG evidence dialog', () => {
    mountTable({ interactive: false })
    pressKey('a')
    expect(openAcmgEvidenceDialogSpy).not.toHaveBeenCalled()
  })

  it('interactive=true: "s" triggers star toggle (baseline for the gate)', () => {
    mountTable({ interactive: true })
    pressKey('s')
    expect(handleStarToggleSpy).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['Ctrl+C (copy)', { key: 'c', ctrlKey: true }],
    ['Cmd+C (copy)', { key: 'c', metaKey: true }],
    ['Ctrl+A (select all)', { key: 'a', ctrlKey: true }],
    ['Cmd+A (select all)', { key: 'a', metaKey: true }],
    ['Ctrl+S (save page)', { key: 's', ctrlKey: true }],
    ['Alt+S', { key: 's', altKey: true }]
  ])('row letter shortcuts leave browser combo %s alone', (_label, init) => {
    mountTable({ interactive: true })
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
    window.dispatchEvent(event)
    expect(handleStarToggleSpy).not.toHaveBeenCalled()
    expect(openCommentDialogSpy).not.toHaveBeenCalled()
    expect(openAcmgEvidenceDialogSpy).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  })
})
