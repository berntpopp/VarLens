import { computed, ref, toValue, type MaybeRefOrGetter, type Ref } from 'vue'
import { useDisplay } from 'vuetify'
import { columnWidthRem } from '../components/variant-table/column-widths'
import { readRootFontPx } from './useRootFontSize'
import {
  computeAutoHiddenColumns,
  getColumnPriority,
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

  return {
    tier,
    width,
    defaultSidebarWidth,
    showModeToggleLabels,
    showContextIndicator,
    showFooterLinks,
    detailPanelFullWidth,
    detailPanelDocked,
    getColumnPriority
  }
}

/**
 * Visible width (CSS px) of the mounted case/cohort table, published by
 * `useTableScroll`'s resize observer. Null until a table has been measured.
 */
export const tableViewportWidthPx = ref<number | null>(null)

/**
 * Responsive default column visibility. `autoHidden` holds the keys hidden by
 * default because they do not fit the table width (viewport width until the
 * table is measured), ranked by `COLUMN_PRIORITY`; columns with an explicit
 * user visibility choice are never part of it. `isVisible` resolves the
 * effective visibility (explicit choice first, then the default).
 */
export function useAutoHiddenColumns(
  keys: MaybeRefOrGetter<readonly string[]>,
  prefs: Readonly<Ref<{ visibility: Readonly<Record<string, boolean>> }>>
) {
  const { width } = useDisplay()
  // ponytail: rem size read on resize only; a text-size change alone refits on the next resize
  const autoHidden = computed(() =>
    computeAutoHiddenColumns(
      toValue(keys),
      (tableViewportWidthPx.value ?? width.value) / readRootFontPx(),
      columnWidthRem,
      prefs.value.visibility
    )
  )
  const isVisible = (key: string): boolean =>
    isColumnVisible(key, prefs.value.visibility, autoHidden.value)
  return { autoHidden, isVisible }
}
