import { createPinia } from 'pinia'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { ref, computed, defineComponent, KeepAlive } from 'vue'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import {
  AppStateKey,
  type AppStateReturn
} from '../../../../src/renderer/src/composables/useAppState'

const moveDownSpy = vi.fn()
const moveUpSpy = vi.fn()
const selectByClickSpy = vi.fn()
const clearSelectionSpy = vi.fn()
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
    selectByClick: selectByClickSpy,
    moveUp: moveUpSpy,
    moveDown: moveDownSpy,
    clearSelection: clearSelectionSpy,
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

const bulkClearSpy = vi.fn()
vi.mock(
  '../../../../src/renderer/src/composables/useBulkTriageSelection',
  async (importOriginal) => {
    const mod =
      await importOriginal<
        typeof import('../../../../src/renderer/src/composables/useBulkTriageSelection')
      >()
    return {
      ...mod,
      useBulkTriageSelection: (...args: Parameters<typeof mod.useBulkTriageSelection>) => {
        const bulk = mod.useBulkTriageSelection(...args)
        return {
          ...bulk,
          clearSelection: () => {
            bulkClearSpy()
            bulk.clearSelection()
          }
        }
      }
    }
  }
)

import VariantTable from '../../../../src/renderer/src/components/VariantTable.vue'

const vuetify = createVuetify({ components, directives })
const mountedWrappers: VueWrapper[] = []

function mountTable(appStateOverride?: Partial<AppStateReturn>): VueWrapper {
  const defaultAppState = {
    selectedCaseId: ref(1),
    selectedVariantId: ref(null),
    selectedPanelVariant: ref(null),
    panelOpen: ref(false),
    detailsTab: ref('details'),
    tableActive: ref(true),
    shortlistActive: ref(false),
    confirmPanelLeave: undefined
  } as unknown as AppStateReturn
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
    fakeSelectedItem.value = { id: 42, chr: '1', pos: 100, ref: 'A', alt: 'T' }
    vi.useFakeTimers()
    moveDownSpy.mockClear()
    moveUpSpy.mockClear()
    selectByClickSpy.mockClear()
    clearSelectionSpy.mockClear()
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    while (mountedWrappers.length > 0) {
      mountedWrappers.pop()?.unmount()
    }
  })

  it('clears the bulk selection when the variant-type tab changes', async () => {
    const wrapper = mountTable()
    bulkClearSpy.mockClear()
    await wrapper.setProps({ variantType: 'cnv' } as never)
    expect(bulkClearSpy).toHaveBeenCalled()
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

  it('cancels sync and reverts selection when confirmPanelLeave resolves false', async () => {
    const selectedVariant = { id: 10, chr: '1', pos: 50, ref: 'C', alt: 'G' }
    const wrapper = mountTable({
      panelOpen: ref(true),
      selectedPanelVariant: ref(selectedVariant),
      confirmPanelLeave: vi.fn().mockResolvedValue(false)
    })
    selectByClickSpy.mockClear()

    dispatchKey('ArrowDown')
    vi.advanceTimersByTime(110)
    await flushPromises()

    expect(selectByClickSpy).toHaveBeenCalledWith(selectedVariant)
    expect(wrapper.emitted('row-click')).toBeFalsy()
  })

  it('proceeds with sync when confirmPanelLeave resolves true', async () => {
    const wrapper = mountTable({
      panelOpen: ref(true),
      confirmPanelLeave: vi.fn().mockResolvedValue(true)
    })

    dispatchKey('ArrowDown')
    vi.advanceTimersByTime(110)
    await flushPromises()

    expect(wrapper.emitted('row-click')).toBeTruthy()
    expect(wrapper.emitted('row-click')![0]).toEqual([fakeSelectedItem.value])
  })

  it('performs two-stage Escape: closes panel on first Escape, clears selection on second Escape', () => {
    const panelOpen = ref(true)
    const wrapper = mountTable({ panelOpen })
    clearSelectionSpy.mockClear()

    // First Escape: closes panel, preserves row selection
    dispatchKey('Escape')
    expect(panelOpen.value).toBe(false)
    expect(clearSelectionSpy).not.toHaveBeenCalled()
    expect(wrapper.emitted('deselect')).toBeFalsy()

    // Second Escape: panel already closed, clears row selection
    dispatchKey('Escape')
    expect(clearSelectionSpy).toHaveBeenCalledTimes(1)
    expect(wrapper.emitted('deselect')).toBeTruthy()
  })

  it('ignores Escape when event was already defaultPrevented by a modal or child', () => {
    const panelOpen = ref(true)
    const wrapper = mountTable({ panelOpen })
    clearSelectionSpy.mockClear()

    const event = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })
    event.preventDefault()
    window.dispatchEvent(event)

    expect(panelOpen.value).toBe(true)
    expect(clearSelectionSpy).not.toHaveBeenCalled()
    expect(wrapper.emitted('deselect')).toBeFalsy()
  })

  it('cancels debounced panel sync if interactive becomes false before debounce fires', async () => {
    const wrapper = mountTable({ panelOpen: ref(true) })
    dispatchKey('ArrowDown')
    expect(moveDownSpy).toHaveBeenCalledTimes(1)

    // Deactivate table before 100ms fires
    await wrapper.setProps({ interactive: false })
    vi.advanceTimersByTime(120)
    await flushPromises()

    expect(wrapper.emitted('row-click')).toBeFalsy()
  })

  it('does not emit row-click if selectedItem becomes null while confirmPanelLeave is pending', async () => {
    let resolveLeave!: (ok: boolean) => void
    const leavePromise = new Promise<boolean>((resolve) => {
      resolveLeave = resolve
    })
    const wrapper = mountTable({
      panelOpen: ref(true),
      confirmPanelLeave: vi.fn().mockReturnValue(leavePromise)
    })

    dispatchKey('ArrowDown')
    vi.advanceTimersByTime(110)

    // While leavePromise is pending, selection clears/becomes null
    fakeSelectedItem.value = null
    resolveLeave(true)
    await flushPromises()

    expect(wrapper.emitted('row-click')).toBeFalsy()
  })

  it('cancels debounced panel sync and ignores arrow keys when deactivated via KeepAlive', async () => {
    const active = ref(true)
    const appState = {
      panelOpen: ref(true),
      selectedPanelVariant: ref(null),
      confirmPanelLeave: vi.fn().mockResolvedValue(true)
    } as unknown as AppStateReturn

    const Parent = defineComponent({
      components: { KeepAlive, VariantTable },
      setup() {
        return { active, appState }
      },
      template: `
        <KeepAlive>
          <VariantTable
            v-if="active"
            :case-id="1"
            :filters="{}"
            variant-type="snv"
            :interactive="true"
          />
        </KeepAlive>
      `
    })

    const wrapper = mount(Parent, {
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
    mountedWrappers.push(wrapper as unknown as VueWrapper<InstanceType<typeof VariantTable>>)

    const table = wrapper.findComponent(VariantTable)
    expect(table.exists()).toBe(true)

    // Arrow down starts 100ms debounced sync
    dispatchKey('ArrowDown')
    expect(moveDownSpy).toHaveBeenCalledTimes(1)

    // Deactivate component via KeepAlive
    active.value = false
    await flushPromises()

    // Advance timers past debounce
    vi.advanceTimersByTime(120)
    await flushPromises()

    expect(table.emitted('row-click')).toBeFalsy()

    // Key presses while deactivated must be ignored
    dispatchKey('ArrowDown')
    expect(moveDownSpy).toHaveBeenCalledTimes(1)
  })
})
