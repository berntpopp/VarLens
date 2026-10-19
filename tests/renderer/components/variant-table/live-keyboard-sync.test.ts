import { createPinia } from 'pinia'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { ref, computed } from 'vue'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import { AppStateKey, type AppState } from '../../../../src/renderer/src/composables/useAppState'

const moveDownSpy = vi.fn()
const moveUpSpy = vi.fn()
const fakeSelectedItem = ref<Record<string, unknown> | null>({
  id: 42,
  chr: '1',
  pos: 100,
  ref: 'A',
  alt: 'T'
})

vi.mock('../../../../src/renderer/src/composables/useTableKeyboardNav', async (importOriginal) => ({
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
    clearSelection: vi.fn(),
    isInputFocused: () => false
  }),
  isControlFocused: () => false,
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
  annotationCache: ref(new Map())
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
  useFamilyMembers: () => ref([]),
  useVariantColumns: () => ({
    headers: computed(() => []),
    visibleHeaders: computed(() => []),
    filterableColumns: computed(() => [])
  })
}))

vi.mock('../../../../src/renderer/src/components/variant-table/useVariantData', () => ({
  useVariantData: () => ({
    variants: ref([fakeSelectedItem.value]),
    totalCount: ref(1),
    loading: ref(false),
    page: ref(1),
    itemsPerPage: ref(50),
    sortBy: ref([]),
    itemsPerPageOptions: [50, 100, 200],
    selectedVariantId: ref(42),
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

vi.mock('../../../../src/renderer/src/components/AnnotationDialogs.vue', () => ({
  default: {
    name: 'AnnotationDialogs',
    setup(_props: unknown, { expose }: { expose: (o: Record<string, unknown>) => void }) {
      expose({
        handleStarToggle: vi.fn(),
        handleQuickAcmgSelect: vi.fn(),
        openAcmgEvidenceDialog: vi.fn(),
        openCommentDialog: vi.fn()
      })
      return () => null
    }
  }
}))

import VariantTable from '../../../../src/renderer/src/components/VariantTable.vue'

const vuetify = createVuetify({ components, directives })
const mountedWrappers: VueWrapper[] = []

function mountTable(appStateOverride?: Partial<AppState>): VueWrapper {
  const defaultAppState: AppState = {
    selectedCaseId: ref(1),
    selectedVariantId: ref(null),
    selectedPanelVariant: ref(null),
    panelOpen: ref(false),
    detailsTab: ref('details'),
    tableActive: ref(true),
    shortlistActive: ref(false)
  }
  const appState = { ...defaultAppState, ...appStateOverride }

  const wrapper = mount(VariantTable, {
    props: {
      caseId: 1,
      filters: {},
      variantType: 'snv',
      interactive: true
    } as never,
    global: {
      plugins: [vuetify, createPinia()],
      provide: {
        [AppStateKey as symbol]: appState
      },
      stubs: {
        VDataTableServer: { template: '<div class="stub-table" />' },
        VariantColumnHeader: true
      }
    }
  })
  mountedWrappers.push(wrapper)
  return wrapper
}

function dispatchKey(key: string): void {
  window.dispatchEvent(
    new KeyboardEvent('keydown', {
      key,
      bubbles: true,
      cancelable: true
    })
  )
}

describe('VariantTable live keyboard sync & triage shortcuts', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    moveDownSpy.mockClear()
    moveUpSpy.mockClear()
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    while (mountedWrappers.length > 0) {
      mountedWrappers.pop()?.unmount()
    }
  })

  it('triggers row-click on "i" shortcut', () => {
    const wrapper = mountTable()
    dispatchKey('i')
    expect(wrapper.emitted('row-click')).toBeTruthy()
    expect(wrapper.emitted('row-click')![0]).toEqual([fakeSelectedItem.value])
  })

  it('does NOT live-sync details on arrow key when drawer is closed', () => {
    const wrapper = mountTable({ panelOpen: ref(false) })
    dispatchKey('ArrowDown')
    expect(moveDownSpy).toHaveBeenCalledTimes(1)

    // Advance timers past debounce
    vi.advanceTimersByTime(200)

    expect(wrapper.emitted('row-click')).toBeFalsy()
  })

  it('debounces live-sync details on arrow key when drawer is open', () => {
    const wrapper = mountTable({ panelOpen: ref(true) })
    dispatchKey('ArrowDown')
    expect(moveDownSpy).toHaveBeenCalledTimes(1)

    // Before debounce duration, no row-click emitted yet
    vi.advanceTimersByTime(50)
    expect(wrapper.emitted('row-click')).toBeFalsy()

    // Another arrow move within 100ms resets the debounce timer
    dispatchKey('ArrowDown')
    expect(moveDownSpy).toHaveBeenCalledTimes(2)

    vi.advanceTimersByTime(60)
    expect(wrapper.emitted('row-click')).toBeFalsy()

    // Settle past debounce duration
    vi.advanceTimersByTime(60)
    expect(wrapper.emitted('row-click')).toBeTruthy()
    expect(wrapper.emitted('row-click')!.length).toBe(1)
    expect(wrapper.emitted('row-click')![0]).toEqual([fakeSelectedItem.value])
  })
})
