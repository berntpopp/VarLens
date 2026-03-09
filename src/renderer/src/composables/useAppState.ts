/**
 * Shared application state composable.
 *
 * Centralizes state that is shared between App.vue (shell) and route views
 * (CaseView, CohortView). Uses a module-level singleton pattern so all
 * consumers share the same reactive refs.
 */
import { ref, computed } from 'vue'
import type { VariantFilter, Variant } from '../../../shared/types/api'
import type { CohortVariant } from '../../../shared/types/cohort'
import type VariantTable from '../components/VariantTable.vue'
import type FilterToolbar from '../components/FilterToolbar.vue'
import type CohortViewComponent from '../components/CohortView.vue'

// Module-level singleton state
const selectedCaseId = ref<number | null>(null)
const selectedCaseName = ref<string>('')
const selectedVariantCount = ref(0)
const selectedCreatedAt = ref(0)
const caseCount = ref(0)

const activeTab = ref<'case' | 'cohort'>('case')

const currentFilters = ref<Omit<VariantFilter, 'case_id'>>({})
const filteredCount = ref(0)
const totalCount = ref(0)
const hasSort = ref(false)
const initialSearch = ref<string | undefined>(undefined)

const panelOpen = ref(false)
const selectedPanelVariant = ref<Variant | CohortVariant | null>(null)

const sidebarOpen = ref(true)

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

export function useAppState() {
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
