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
import { ref, computed, inject } from 'vue'
import type { Ref, ComputedRef, InjectionKey } from 'vue'
import type { VariantFilter, Variant } from '../../../shared/types/api'
import type { CohortVariant } from '../../../shared/types/cohort'
import type VariantTable from '../components/VariantTable.vue'
import type FilterToolbar from '../components/FilterToolbar.vue'
import type CohortViewComponent from '../components/CohortView.vue'

/** Shape of the object returned by createAppState / useAppState. */
export interface AppStateReturn {
  // Case selection
  selectedCaseId: Ref<number | null>
  selectedCaseName: Ref<string>
  selectedVariantCount: Ref<number>
  selectedCreatedAt: Ref<number>
  caseCount: Ref<number>

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

  // Snackbar
  setSnackbarHandler: (
    fn: (message: string, type: string, options?: Record<string, unknown>) => void
  ) => void
  showSnack: (message: string, type: string, options?: Record<string, unknown>) => void
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

  // Navigation
  const activeTab = ref<'case' | 'cohort'>('case')
  const sidebarOpen = ref(true)

  // Filters
  const currentFilters = ref<Omit<VariantFilter, 'case_id'>>({})
  const filteredCount = ref(0)
  const totalCount = ref(0)
  const hasSort = ref(false)
  const initialSearch = ref<string | undefined>(undefined)

  // Panel
  const panelOpen = ref(false)
  const selectedPanelVariant = ref<Variant | CohortVariant | null>(null)

  // Component refs (shared so App.vue and views can coordinate)
  const variantTableRef = ref<InstanceType<typeof VariantTable> | null>(null)
  const filterToolbarRef = ref<InstanceType<typeof FilterToolbar> | null>(null)
  const cohortViewRef = ref<InstanceType<typeof CohortViewComponent> | null>(null)

  // Snackbar callback (set by App.vue, called by views)
  let showSnackbar:
    | ((message: string, type: string, options?: Record<string, unknown>) => void)
    | null = null

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

  // Computed
  const panelMode = computed(() => (activeTab.value === 'case' ? 'case' : 'cohort'))

  return {
    // Case selection
    selectedCaseId,
    selectedCaseName,
    selectedVariantCount,
    selectedCreatedAt,
    caseCount,

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

    // Snackbar
    setSnackbarHandler,
    showSnack
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
