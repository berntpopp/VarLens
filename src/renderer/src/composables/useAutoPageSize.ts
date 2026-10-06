/**
 * "Auto (fit)" page size for the case and cohort tables: the page holds as
 * many rows as fit the visible table body, recalculated (debounced) when the
 * table container resizes.
 *
 * No layout-shift loop: the table wrapper is a flex child of a fixed-height
 * container, so its height never depends on how many rows are rendered —
 * applying a new page size cannot re-trigger the measurement.
 *
 * Vuetify's footer select only carries numbers, so "Auto" is a sentinel
 * option value while inactive; while active the Auto option carries the
 * current fit count (and a fixed option with the same number is hidden) so
 * the select shows "Auto (fit)".
 */
import { computed, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'
import { useDebounceFn } from '@vueuse/core'
import { useSettingsStore } from '../stores/settingsStore'
import { readRootFontPx } from './useRootFontSize'

/** Footer-select value that switches Auto (fit) on. Never used as a page size. */
export const AUTO_PAGE_SIZE = -2
export const AUTO_PAGE_SIZE_TITLE = '$vuetify.dataFooter.itemsPerPageAuto'
export const MIN_AUTO_ROWS = 5
export const MAX_AUTO_ROWS = 100
/** Compact-density data row height at a 16 px root (fallback before rows render). */
const DEFAULT_ROW_HEIGHT_REM = 2.25
const RESIZE_DEBOUNCE_MS = 150

export type PageSizeOption = number | { title: string; value: number }

export function computeFitRows(bodyHeightPx: number, rowHeightPx: number): number {
  if (!(bodyHeightPx > 0) || !(rowHeightPx > 0)) return MIN_AUTO_ROWS
  const rows = Math.floor(bodyHeightPx / rowHeightPx)
  return Math.min(MAX_AUTO_ROWS, Math.max(MIN_AUTO_ROWS, rows))
}

export function buildPageSizeOptions(
  fixed: readonly number[],
  autoActive: boolean,
  fitRows: number
): PageSizeOption[] {
  if (!autoActive) return [...fixed, { title: AUTO_PAGE_SIZE_TITLE, value: AUTO_PAGE_SIZE }]
  return [...fixed.filter((n) => n !== fitRows), { title: AUTO_PAGE_SIZE_TITLE, value: fitRows }]
}

/** The page that keeps the current first row visible after a page-size change. */
export function pageKeepingFirstRow(page: number, oldSize: number, newSize: number): number {
  if (oldSize <= 0 || newSize <= 0) return 1
  return Math.floor(((page - 1) * oldSize) / newSize) + 1
}

/** Visible body height and row height of a rendered Vuetify table inside `container`. */
export function measureTableBody(container: HTMLElement): { body: number; row: number } | null {
  const wrapper = container.querySelector<HTMLElement>('.v-table__wrapper')
  if (wrapper === null || wrapper.clientHeight === 0) return null
  const head = wrapper.querySelector('thead')?.getBoundingClientRect().height ?? 0
  const dataRow = wrapper.querySelector<HTMLElement>('tbody tr.v-data-table__tr')
  const row = dataRow?.getBoundingClientRect().height ?? DEFAULT_ROW_HEIGHT_REM * readRootFontPx()
  return { body: wrapper.clientHeight - head, row }
}

interface AutoPageSizeOptions {
  itemsPerPage: Ref<number>
  page: Ref<number>
  /** Fixed page-size choices offered next to Auto. */
  fixedOptions: readonly number[]
  /** Element holding the table (its `.v-table__wrapper` is measured). */
  container: Ref<HTMLElement | null>
  /** Row count of the current page; the first rendered page refines the row height. */
  rowCount: Ref<number>
}

export function useAutoPageSize(options: AutoPageSizeOptions) {
  const settings = useSettingsStore()
  const { itemsPerPage, page, container } = options
  const fitRows = ref(itemsPerPage.value)

  function applyFit(): void {
    const el = container.value
    if (el === null) return
    const size = measureTableBody(el)
    if (size === null) return
    fitRows.value = computeFitRows(size.body, size.row)
    if (!settings.autoFitPageSize || fitRows.value === itemsPerPage.value) return
    page.value = pageKeepingFirstRow(page.value, itemsPerPage.value, fitRows.value)
    itemsPerPage.value = fitRows.value
  }
  const applyFitDebounced = useDebounceFn(applyFit, RESIZE_DEBOUNCE_MS)

  let observer: ResizeObserver | null = null
  onMounted(() => {
    if (typeof ResizeObserver === 'undefined' || container.value === null) return
    observer = new ResizeObserver(() => void applyFitDebounced())
    observer.observe(container.value)
  })
  onBeforeUnmount(() => observer?.disconnect())

  // First real rows give the true row height (chips, text size); measure once more then
  watch(
    () => options.rowCount.value > 0,
    (hasRows) => {
      if (hasRows) void applyFitDebounced()
    }
  )

  /** v-model for the table's items-per-page (decodes the Auto sentinel). */
  const tableItemsPerPage = computed<number>({
    get: () => itemsPerPage.value,
    set: (value) => {
      if (value === AUTO_PAGE_SIZE) {
        settings.autoFitPageSize = true
        applyFit()
        return
      }
      if (settings.autoFitPageSize && value === fitRows.value) return
      settings.autoFitPageSize = false
      itemsPerPage.value = value
    }
  })

  const pageSizeOptions = computed(() =>
    buildPageSizeOptions(options.fixedOptions, settings.autoFitPageSize, fitRows.value)
  )

  return { tableItemsPerPage, pageSizeOptions, fitRows, applyFit }
}
