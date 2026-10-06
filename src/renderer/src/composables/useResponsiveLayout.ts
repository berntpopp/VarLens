import { computed, toValue, type MaybeRefOrGetter, type Ref } from 'vue'
import { useDisplay } from 'vuetify'
import {
  computeAutoHiddenColumns,
  getColumnPriority,
  getMaxAutoVisibleColumns,
  isColumnVisible,
  isDetailPanelDocked
} from '../utils/responsive-layout'

export type LayoutTier = 'full' | 'compact' | 'narrow'

export function useResponsiveLayout() {
  const { mdAndUp, lgAndUp, width } = useDisplay()

  const tier = computed<LayoutTier>(() => {
    if (lgAndUp.value) return 'full'
    if (mdAndUp.value) return 'compact'
    return 'narrow'
  })

  // Sidebar defaults by tier (user can still resize)
  const defaultSidebarWidth = computed(() => {
    if (tier.value === 'narrow') return 300
    if (tier.value === 'compact') return 240
    return 280
  })

  // Show text labels on CASE/COHORT toggle buttons
  const showModeToggleLabels = computed(() => tier.value === 'full')

  // Show context indicator (case name) in app bar
  const showContextIndicator = computed(() => tier.value !== 'narrow')

  // Show individual footer link buttons vs overflow menu
  const showFooterLinks = computed(() => tier.value !== 'narrow')

  // Detail panel becomes full-width overlay at narrow
  const detailPanelFullWidth = computed(() => tier.value === 'narrow')

  // Detail panel docks beside the table (shrinking v-main) on wide viewports
  const detailPanelDocked = computed(() => isDetailPanelDocked(width.value))

  // Maximum data columns to auto-show at the current viewport width
  const maxAutoVisibleColumns = computed(() => getMaxAutoVisibleColumns(width.value))

  return {
    tier,
    width,
    defaultSidebarWidth,
    showModeToggleLabels,
    showContextIndicator,
    showFooterLinks,
    detailPanelFullWidth,
    detailPanelDocked,
    maxAutoVisibleColumns,
    getColumnPriority
  }
}

/**
 * Responsive default column visibility. `autoHidden` holds the keys hidden by
 * default at the current viewport width, ranked by `COLUMN_PRIORITY`; columns
 * with an explicit user visibility choice are never part of it. `isVisible`
 * resolves the effective visibility (explicit choice first, then the default).
 */
export function useAutoHiddenColumns(
  keys: MaybeRefOrGetter<readonly string[]>,
  prefs: Readonly<Ref<{ visibility: Readonly<Record<string, boolean>> }>>
) {
  const { maxAutoVisibleColumns } = useResponsiveLayout()
  const autoHidden = computed(() =>
    computeAutoHiddenColumns(toValue(keys), maxAutoVisibleColumns.value, prefs.value.visibility)
  )
  const isVisible = (key: string): boolean =>
    isColumnVisible(key, prefs.value.visibility, autoHidden.value)
  return { autoHidden, isVisible }
}
