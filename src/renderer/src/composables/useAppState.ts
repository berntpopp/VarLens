/**
 * Shared application state composable.
 *
 * Centralizes state that is shared between App.vue (shell) and route views
 * (CaseView, CohortView). Uses Vue's provide/inject pattern so that all
 * consumers share the same reactive instance created by the root component.
 *
 * Usage:
 * - In App.vue (root): call `createAppState()` and `provide(AppStateKey, ...)`
 * - In child components: call `useAppState()` which injects from the provider
 */
import { invalidateServerData } from '../queries/invalidation'
import { ref, computed, inject, toRaw } from 'vue'
import type { Ref, ComputedRef, InjectionKey } from 'vue'
import type { VariantFilter, Variant } from '../../../shared/types/api'
import type { CohortVariant } from '../../../shared/types/cohort'
import type VariantTable from '../components/VariantTable.vue'
import type FilterToolbar from '../components/FilterToolbar.vue'
import type CohortViewComponent from '../components/CohortView.vue'

/** Shape of the object returned by createAppState / useAppState. */
export interface SelectedCaseInput {
  caseId: number
  caseName: string
  variantCount?: number
  createdAt?: number
}

export interface AppStateReturn {
  // Case selection
  selectedCaseId: Ref<number | null>
  selectedCaseName: Ref<string>
  selectedVariantCount: Ref<number>
  selectedCreatedAt: Ref<number>
  caseCount: Ref<number>
  /** True once the sidebar case list has answered at least once (or failed). */
  casesLoaded: Ref<boolean>

  // Navigation
  activeTab: Ref<'case' | 'cohort'>
  sidebarOpen: Ref<boolean>

  // Filters
  currentFilters: Ref<Omit<VariantFilter, 'case_id'>>
  filteredCount: Ref<number>
  totalCount: Ref<number>
  hasSort: Ref<boolean>
  initialSearch: Ref<string | undefined>

  // Panel
  panelOpen: Ref<boolean>
  selectedPanelVariant: Ref<Variant | CohortVariant | null>
  panelMode: ComputedRef<'case' | 'cohort'>

  // Component refs
  variantTableRef: Ref<InstanceType<typeof VariantTable> | null>
  filterToolbarRef: Ref<InstanceType<typeof FilterToolbar> | null>
  cohortViewRef: Ref<InstanceType<typeof CohortViewComponent> | null>

  // Data generation (incremented on import/delete for KeepAlive invalidation)
  dataGeneration: Ref<number>

  // Shell-owned reset actions
  setCaseCount: (count: number) => void
  markCasesLoadFailed: () => void
  incrementDataGeneration: () => void
  setActiveTab: (tab: 'case' | 'cohort') => void
  openSidebar: () => void
  closeSidebar: () => void
  clearSelectedCase: () => void
  resetCaseFilters: () => void
  resetCaseContext: () => void
  resetForDatabaseSwitch: (options?: { keepView?: boolean }) => void
  returnToCaseHome: () => void
  selectCase: (input: SelectedCaseInput) => void

  /**
   * The details panel registers the check for an unsaved ACMG draft: null when
   * there is none, otherwise the user's answer to the prompt (true = leave).
   */
  setPanelLeaveGuard: (fn: (() => Promise<boolean> | null) | null) => void
  /** Null when the open panel has no unsaved draft, else the prompt's answer (true = leave). */
  confirmPanelLeave: () => Promise<boolean> | null

  // Snackbar
  setSnackbarHandler: (
    fn: (message: string, type: string, options?: Record<string, unknown>) => void
  ) => void
  showSnack: (message: string, type: string, options?: Record<string, unknown>) => void

  // Case metadata dialog
  setCaseMetadataHandler: (fn: () => void) => void
  openCaseMetadata: () => void

  // Import dialog (owned by the shell's dialog host; views request it here)
  setImportHandler: (fn: () => void) => void
  openImport: () => void
}

/** Injection key for the shared app state. */
export const AppStateKey: InjectionKey<AppStateReturn> = Symbol('appState')

/**
 * Factory function – creates a NEW app state instance.
 * Call this once in the root component (App.vue) and provide it via `provide(AppStateKey, ...)`.
 */
export function createAppState(): AppStateReturn {
  // Case selection
  const selectedCaseId = ref<number | null>(null)
  const selectedCaseName = ref<string>('')
  const selectedVariantCount = ref(0)
  const selectedCreatedAt = ref(0)
  const caseCount = ref(0)
  const casesLoaded = ref(false)

  // Everything that would move the open details panel off its variant (new
  // selection, close, tab or case switch) waits for the unsaved-draft prompt.
  let leaveGuard: (() => Promise<boolean> | null) | null = null
  let leaving: Promise<boolean> | null = null
  let leaveEpoch = 0

  function setPanelLeaveGuard(fn: (() => Promise<boolean> | null) | null): void {
    leaveGuard = fn
  }

  /** One prompt at a time: everything that asks while it is open shares its answer. */
  function confirmPanelLeave(): Promise<boolean> | null {
    if (leaving !== null) return leaving
    const answer = panelOpenRaw.value ? (leaveGuard?.() ?? null) : null
    if (answer === null) return null
    const epoch = leaveEpoch
    leaving = answer.then((leave) => {
      // A database switch in between already closed the panel: drop what was held.
      if (epoch !== leaveEpoch) return false
      leaving = null
      return leave
    })
    return leaving
  }

  function guardLeave(action: () => void): void {
    const answer = confirmPanelLeave()
    if (answer === null) action()
    else void answer.then((leave) => leave && action())
  }

  function guarded<T>(source: Ref<T>): Ref<T> {
    return computed({
      get: () => source.value,
      set: (value) => {
        if (toRaw(value) !== toRaw(source.value)) guardLeave(() => (source.value = value))
      }
    })
  }

  // Navigation
  const activeTab = guarded(ref<'case' | 'cohort'>('case'))
  const sidebarOpen = ref(true)

  // Filters
  const currentFilters = ref<Omit<VariantFilter, 'case_id'>>({})
  const filteredCount = ref(0)
  const totalCount = ref(0)
  const hasSort = ref(false)
  const initialSearch = ref<string | undefined>(undefined)

  // Panel
  const panelOpenRaw = ref(false)
  const panelOpen = guarded(panelOpenRaw)
  const selectedPanelVariant = guarded(ref<Variant | CohortVariant | null>(null))

  // Component refs (shared so App.vue and views can coordinate)
  const variantTableRef = ref<InstanceType<typeof VariantTable> | null>(null)
  const filterToolbarRef = ref<InstanceType<typeof FilterToolbar> | null>(null)
  const cohortViewRef = ref<InstanceType<typeof CohortViewComponent> | null>(null)

  // Data generation counter — incremented on import/delete for KeepAlive stale data detection
  const dataGeneration = ref(0)

  // Snackbar callback (set by App.vue, called by views)
  let showSnackbar:
    ((message: string, type: string, options?: Record<string, unknown>) => void) | null = null

  function setSnackbarHandler(
    fn: (message: string, type: string, options?: Record<string, unknown>) => void
  ): void {
    showSnackbar = fn
  }

  function showSnack(message: string, type: string, options?: Record<string, unknown>): void {
    if (showSnackbar !== null) {
      showSnackbar(message, type, options)
    }
  }

  let _caseMetadataHandler: (() => void) | null = null
  function setCaseMetadataHandler(fn: () => void): void {
    _caseMetadataHandler = fn
  }
  function openCaseMetadata(): void {
    _caseMetadataHandler?.()
  }

  let _importHandler: (() => void) | null = null
  function setImportHandler(fn: () => void): void {
    _importHandler = fn
  }
  function openImport(): void {
    _importHandler?.()
  }

  // A panel left open would pair the old case's variant with the new case id,
  // so its annotation writes would land under the wrong case.
  function setSelectedCaseId(id: number | null): void {
    if (id !== selectedCaseId.value) {
      panelOpenRaw.value = false
      selectedPanelVariant.value = null
    }
    selectedCaseId.value = id
  }

  function clearSelectedCase(): void {
    guardLeave(() => setSelectedCaseId(null))
  }

  function setCaseCount(count: number): void {
    caseCount.value = count
    casesLoaded.value = true
  }

  function markCasesLoadFailed(): void {
    casesLoaded.value = true
  }

  function incrementDataGeneration(): void {
    dataGeneration.value++
  }

  function setActiveTab(tab: 'case' | 'cohort'): void {
    activeTab.value = tab
  }

  function openSidebar(): void {
    sidebarOpen.value = true
  }

  function closeSidebar(): void {
    sidebarOpen.value = false
  }

  function resetCaseFilters(): void {
    currentFilters.value = {}
    hasSort.value = false
  }

  function resetCaseContext(): void {
    guardLeave(() => {
      clearSelectedCase()
      selectedCaseName.value = ''
      selectedVariantCount.value = 0
      selectedCreatedAt.value = 0
      resetCaseFilters()
      filteredCount.value = 0
      totalCount.value = 0
    })
  }

  /**
   * `keepView` leaves the active view alone. It is for the first time the
   * database path becomes known after startup, which is not a switch: forcing
   * the case tab there turned a direct load of `/cohort` into `/case`.
   */
  function resetForDatabaseSwitch(options: { keepView?: boolean } = {}): void {
    // The old database's draft cannot be saved any more: close without asking.
    panelOpenRaw.value = false
    leaveEpoch++
    leaving = null
    void invalidateServerData('database-switch')
    incrementDataGeneration()
    resetCaseContext()
    if (options.keepView !== true) setActiveTab('case')
    selectedPanelVariant.value = null
  }

  function returnToCaseHome(): void {
    guardLeave(() => {
      clearSelectedCase()
      selectedCaseName.value = ''
      setActiveTab('case')
      openSidebar()
    })
  }

  function selectCase(input: SelectedCaseInput): void {
    guardLeave(() => {
      setSelectedCaseId(input.caseId)
      selectedCaseName.value = input.caseName
      selectedVariantCount.value = input.variantCount ?? 0
      selectedCreatedAt.value = input.createdAt ?? 0
      setActiveTab('case')
    })
  }

  // Computed
  const panelMode = computed(() => (activeTab.value === 'case' ? 'case' : 'cohort'))

  return {
    // Case selection
    selectedCaseId,
    selectedCaseName,
    selectedVariantCount,
    selectedCreatedAt,
    caseCount,
    casesLoaded,

    // Navigation
    activeTab,
    sidebarOpen,

    // Filters
    currentFilters,
    filteredCount,
    totalCount,
    hasSort,
    initialSearch,

    // Panel
    panelOpen,
    selectedPanelVariant,
    panelMode,

    // Component refs
    variantTableRef,
    filterToolbarRef,
    cohortViewRef,

    // Data generation
    dataGeneration,

    // Shell-owned reset actions
    setCaseCount,
    markCasesLoadFailed,
    incrementDataGeneration,
    setActiveTab,
    openSidebar,
    closeSidebar,
    clearSelectedCase,
    resetCaseFilters,
    resetCaseContext,
    resetForDatabaseSwitch,
    returnToCaseHome,
    selectCase,
    setPanelLeaveGuard,
    confirmPanelLeave,

    // Snackbar
    setSnackbarHandler,
    showSnack,

    // Case metadata dialog
    setCaseMetadataHandler,
    openCaseMetadata,

    // Import dialog
    setImportHandler,
    openImport
  }
}

/**
 * Consumer function – injects the app state from the nearest provider.
 * Must be called within a component that is a descendant of the component
 * that called `provide(AppStateKey, createAppState())`.
 */
export function useAppState(): AppStateReturn {
  const state = inject(AppStateKey)
  if (!state) {
    throw new Error(
      'useAppState() called without provider. Call createAppState() and provide(AppStateKey, ...) in a parent component.'
    )
  }
  return state
}
