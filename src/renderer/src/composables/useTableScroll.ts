/**
 * useTableScroll composable
 *
 * Provides horizontal scroll synchronization between a top scrollbar element
 * and the table wrapper, plus middle-mouse drag scrolling functionality.
 *
 * Extracted from CohortTable.vue and VariantTable.vue to eliminate duplication
 * (DRY-03 violation - 70+ lines duplicated between both tables).
 *
 * Features:
 * - Bidirectional scroll sync between top scrollbar and table wrapper
 * - Middle-mouse button drag scrolling with 2x speed multiplier
 * - ResizeObserver to keep scrollbar width in sync with table content
 * - Cleanup registry pattern ensures all listeners/observers are properly cleaned up
 *
 * @example
 * ```vue
 * <script setup lang="ts">
 * import { ref, onMounted, nextTick } from 'vue'
 * import { useTableScroll } from '@/composables/useTableScroll'
 * import type { VDataTableServer } from 'vuetify/components'
 *
 * const dataTableRef = ref<InstanceType<typeof VDataTableServer> | null>(null)
 * const { topScrollbarRef, topScrollbarInnerRef, initScrollSync, updateScrollbarWidth } = useTableScroll()
 *
 * onMounted(async () => {
 *   await nextTick()
 *   const tableEl = dataTableRef.value?.$el as HTMLElement | undefined
 *   if (tableEl) {
 *     const tableWrapper = tableEl.querySelector('.v-table__wrapper') as HTMLElement | null
 *     if (tableWrapper) {
 *       initScrollSync(tableWrapper)
 *     }
 *   }
 * })
 * </script>
 *
 * <template>
 *   <div ref="topScrollbarRef" class="top-scrollbar-container">
 *     <div ref="topScrollbarInnerRef" class="top-scrollbar-inner"></div>
 *   </div>
 *   <v-data-table-server ref="dataTableRef" ... />
 * </template>
 * ```
 */

import { ref, onBeforeUnmount } from 'vue'
import type { Ref } from 'vue'

/**
 * Return type for useTableScroll composable
 */
export interface UseTableScrollReturn {
  /** Ref for top scrollbar container element - bind with ref="topScrollbarRef" */
  topScrollbarRef: Ref<HTMLElement | null>
  /** Ref for inner div that sets scrollbar width - bind with ref="topScrollbarInnerRef" */
  topScrollbarInnerRef: Ref<HTMLElement | null>
  /**
   * Initialize scroll sync - call after table is mounted and wrapper element is available
   * @param tableWrapper - The .v-table__wrapper element from Vuetify data table
   */
  initScrollSync: (tableWrapper: HTMLElement) => void
  /**
   * Manually update scrollbar width (e.g., after column resize or data change)
   * Called automatically by ResizeObserver, but can be called manually if needed
   */
  updateScrollbarWidth: () => void
}

/**
 * Composable for table horizontal scroll synchronization and middle-mouse drag
 *
 * @returns Object containing refs and functions for scroll sync functionality
 */
export function useTableScroll(): UseTableScrollReturn {
  // Template refs for top scrollbar elements
  const topScrollbarRef = ref<HTMLElement | null>(null)
  const topScrollbarInnerRef = ref<HTMLElement | null>(null)

  // Internal state (non-reactive for performance)
  let isSyncingScroll = false
  let isMiddleMouseDragging = false
  let middleMouseStartX = 0
  let middleMouseScrollLeft = 0
  let tableWrapperEl: HTMLElement | null = null

  // CLEANUP REGISTRY - all cleanup functions stored here
  // This pattern ensures ALL listeners and observers are properly cleaned up
  const cleanupFns: Array<() => void> = []

  /**
   * Handle scroll event on top scrollbar - sync position to table wrapper
   */
  const handleTopScroll = (): void => {
    if (isSyncingScroll || !tableWrapperEl || !topScrollbarRef.value) return
    isSyncingScroll = true
    tableWrapperEl.scrollLeft = topScrollbarRef.value.scrollLeft
    isSyncingScroll = false
  }

  /**
   * Handle scroll event on table wrapper - sync position to top scrollbar
   */
  const handleTableScroll = (): void => {
    if (isSyncingScroll || !tableWrapperEl || !topScrollbarRef.value) return
    isSyncingScroll = true
    topScrollbarRef.value.scrollLeft = tableWrapperEl.scrollLeft
    isSyncingScroll = false
  }

  /**
   * Update top scrollbar inner width to match table content scroll width
   */
  const updateScrollbarWidth = (): void => {
    if (!tableWrapperEl || !topScrollbarInnerRef.value) return
    topScrollbarInnerRef.value.style.width = `${tableWrapperEl.scrollWidth}px`
  }

  /**
   * Handle mousedown event - start middle-mouse drag if button === 1
   */
  const handleMouseDown = (e: MouseEvent): void => {
    if (e.button === 1 && tableWrapperEl) {
      // Middle mouse button
      e.preventDefault()
      isMiddleMouseDragging = true
      middleMouseStartX = e.pageX - tableWrapperEl.offsetLeft
      middleMouseScrollLeft = tableWrapperEl.scrollLeft
      tableWrapperEl.style.cursor = 'grabbing'
    }
  }

  /**
   * Handle mousemove event - drag scroll if middle-mouse is held
   * Uses 2x speed multiplier for faster scrolling
   */
  const handleMouseMove = (e: MouseEvent): void => {
    if (!isMiddleMouseDragging || !tableWrapperEl) return
    e.preventDefault()
    const x = e.pageX - tableWrapperEl.offsetLeft
    const walk = (x - middleMouseStartX) * 2 // 2x speed multiplier
    tableWrapperEl.scrollLeft = middleMouseScrollLeft - walk
  }

  /**
   * Handle mouseup event - end middle-mouse drag
   */
  const handleMouseUp = (): void => {
    if (isMiddleMouseDragging && tableWrapperEl) {
      isMiddleMouseDragging = false
      tableWrapperEl.style.cursor = ''
    }
  }

  /**
   * Prevent default middle-click behavior (auto-scroll popup)
   */
  const handleAuxClick = (e: MouseEvent): void => {
    if (e.button === 1) {
      e.preventDefault()
    }
  }

  /**
   * Initialize scroll synchronization and event listeners
   * Should be called after the table is mounted and wrapper element is available
   *
   * @param tableWrapper - The .v-table__wrapper HTMLElement from Vuetify data table
   */
  const initScrollSync = (tableWrapper: HTMLElement): void => {
    tableWrapperEl = tableWrapper

    // Register top scrollbar scroll listener
    if (topScrollbarRef.value) {
      topScrollbarRef.value.addEventListener('scroll', handleTopScroll)
      cleanupFns.push(() => topScrollbarRef.value?.removeEventListener('scroll', handleTopScroll))
    }

    // Register table wrapper scroll listener
    tableWrapper.addEventListener('scroll', handleTableScroll)
    cleanupFns.push(() => tableWrapper.removeEventListener('scroll', handleTableScroll))

    // Register middle-mouse drag handlers
    tableWrapper.addEventListener('mousedown', handleMouseDown)
    // Document-level handlers needed to track mouse outside table bounds
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    tableWrapper.addEventListener('auxclick', handleAuxClick)

    cleanupFns.push(() => {
      tableWrapper.removeEventListener('mousedown', handleMouseDown)
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      tableWrapper.removeEventListener('auxclick', handleAuxClick)
    })

    // Keep the scrollbar width in sync with the wrapper and the table inside it
    // (content width changes when rows or columns change). The observer's
    // initial notification performs the first sync after layout; reading
    // scrollWidth synchronously here forced an extra layout of the whole page
    // in the middle of the table's mount task.
    const resizeObserver = new ResizeObserver(() => {
      updateScrollbarWidth()
    })
    resizeObserver.observe(tableWrapper)
    const table = tableWrapper.querySelector('table')
    if (table) resizeObserver.observe(table)
    cleanupFns.push(() => resizeObserver.disconnect())
  }

  // AUTO CLEANUP on unmount - prevents memory leaks
  // Iterates through all registered cleanup functions
  onBeforeUnmount(() => {
    cleanupFns.forEach((fn) => fn())
    cleanupFns.length = 0 // Clear array
  })

  return {
    topScrollbarRef,
    topScrollbarInnerRef,
    initScrollSync,
    updateScrollbarWidth
  }
}
