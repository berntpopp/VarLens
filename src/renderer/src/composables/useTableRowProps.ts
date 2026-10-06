/**
 * Composable for shared table row styling logic
 *
 * Extracts duplicated getRowProps() pattern from CohortTable.vue (lines 1329-1343)
 * and VariantTable.vue (lines 623-637) into a reusable composable.
 *
 * Provides:
 * - Zebra striping (odd rows get 'variant-row--striped')
 * - Selection highlighting (matching ID gets 'variant-row--selected')
 *
 * DRY-01: Eliminates 15 lines of duplicated code across both table components.
 */

import type { Ref } from 'vue'

/**
 * Parameters for useTableRowProps composable
 *
 * @template T - The item type in the table (e.g., CohortVariant, Variant)
 * @property selectedId - Ref to the currently selected item ID
 * @property getItemId - Function to extract ID from an item
 */
export interface UseTableRowPropsParams<T> {
  /** Ref containing the currently selected item ID (or null if none selected) */
  selectedId: Ref<string | number | null>
  /** Function to extract the unique ID from an item */
  getItemId: (item: T) => string | number
}

/**
 * Return type for useTableRowProps composable
 *
 * @template T - The item type in the table
 * @property getRowProps - Function to compute row class bindings
 */
export interface UseTableRowPropsReturn<T> {
  /**
   * Get row props for v-data-table :row-props binding
   *
   * @param params - Object with item and index
   * @returns Object with class string for row styling
   */
  getRowProps: (params: { item: T; index: number }) => TableRowProps
}

/**
 * Composable for table row styling with zebra striping and selection
 *
 * @template T - The item type in the table
 * @param params - Configuration with selectedId ref and getItemId function
 * @returns Object with getRowProps function for table binding
 *
 * @example
 * ```typescript
 * // In CohortTable.vue
 * const { getRowProps } = useTableRowProps({
 *   selectedId: selectedVariantKey,
 *   getItemId: (item: CohortVariant) => item.variant_key
 * })
 *
 * // In VariantTable.vue
 * const { getRowProps } = useTableRowProps({
 *   selectedId: selectedVariantId,
 *   getItemId: (item: Variant) => item.id
 * })
 *
 * // In template
 * <v-data-table :row-props="getRowProps" />
 * ```
 */
export interface TableRowProps {
  class: string
  'aria-current'?: 'true'
  tabindex?: number
}

export function useTableRowProps<T>(params: UseTableRowPropsParams<T>): UseTableRowPropsReturn<T> {
  /**
   * Compute class bindings for a table row
   *
   * @param item - The row's data item
   * @param index - The row's index in the visible data
   * @returns Object with class string containing applicable CSS classes
   */
  const getRowProps = ({ item, index }: { item: T; index: number }): TableRowProps => {
    const classes: string[] = []

    // Zebra striping - odd rows get striped background
    if (index % 2 === 1) {
      classes.push('variant-row--striped')
    }

    // Selection highlight - matching ID gets selected styling. The selected row
    // is exposed to assistive tech (aria-current) and is the focus-return target
    // when the details panel closes.
    if (params.getItemId(item) === params.selectedId.value) {
      classes.push('variant-row--selected')
      return { class: classes.join(' '), 'aria-current': 'true', tabindex: 0 }
    }

    return { class: classes.join(' ') }
  }

  return { getRowProps }
}
