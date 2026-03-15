import { ref, computed } from 'vue'
import type { ColumnFilter, ColumnFiltersParam } from '../../../shared/types/column-filters'

/**
 * Composable for per-column typed filtering in data tables.
 * Provides reactive filter state with methods to set/clear filters.
 * Filter values are passed to the backend as column_filters in the query params.
 *
 * Uses typed ColumnFilter (operator + value) instead of plain strings.
 */
export function useColumnFilters() {
  const columnFilters = ref<ColumnFiltersParam>({})

  const hasActiveFilters = computed(() => Object.keys(columnFilters.value).length > 0)

  const activeFilterCount = computed(() => Object.keys(columnFilters.value).length)

  function setColumnFilter(columnKey: string, filter: ColumnFilter | null): void {
    if (filter !== null) {
      columnFilters.value = { ...columnFilters.value, [columnKey]: filter }
    } else {
      const next = { ...columnFilters.value }
      delete next[columnKey]
      columnFilters.value = next
    }
  }

  function clearColumnFilter(columnKey: string): void {
    const next = { ...columnFilters.value }
    delete next[columnKey]
    columnFilters.value = next
  }

  function clearAllColumnFilters(): void {
    columnFilters.value = {}
  }

  function hasFilter(columnKey: string): boolean {
    return columnKey in columnFilters.value
  }

  function getFilter(columnKey: string): ColumnFilter | undefined {
    return columnFilters.value[columnKey]
  }

  /** Get active filters as a plain object for IPC */
  function getColumnFiltersParam(): ColumnFiltersParam | undefined {
    if (Object.keys(columnFilters.value).length === 0) return undefined
    return { ...columnFilters.value }
  }

  return {
    columnFilters,
    hasActiveFilters,
    activeFilterCount,
    setColumnFilter,
    clearColumnFilter,
    clearAllColumnFilters,
    hasFilter,
    getFilter,
    getColumnFiltersParam
  }
}
