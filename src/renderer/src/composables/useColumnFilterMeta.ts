import { computed, type Ref } from 'vue'
import type { ColumnFilterMeta, ColumnFilterMode } from '../../../shared/types/column-filters'
import { COLUMN_FILTER_OVERRIDES, detectFilterMode } from '../config/columnFilterConfig'

/**
 * Composable for deriving column metadata maps and filter modes from raw metadata.
 *
 * DRY: Eliminates duplicate columnMetaMap/columnFilterModes computeds
 * in VariantTable.vue and CohortDataTable.vue.
 *
 * @param columnMeta - Reactive ref (or computed) of ColumnFilterMeta[]
 */
export function useColumnFilterMeta(columnMeta: Ref<ColumnFilterMeta[]>) {
  /** Lookup map: column key -> metadata */
  const columnMetaMap = computed<Record<string, ColumnFilterMeta>>(() => {
    const map: Record<string, ColumnFilterMeta> = {}
    for (const meta of columnMeta.value) {
      map[meta.key] = meta
    }
    return map
  })

  /** Lookup map: column key -> auto-detected or overridden filter mode */
  const columnFilterModes = computed<Record<string, ColumnFilterMode>>(() => {
    const modes: Record<string, ColumnFilterMode> = {}
    // Forced modes hold for columns the metadata does not cover (the stored phenotype score).
    for (const [key, { forceMode }] of Object.entries(COLUMN_FILTER_OVERRIDES)) {
      if (forceMode !== undefined) modes[key] = forceMode
    }
    for (const meta of columnMeta.value) {
      modes[meta.key] = detectFilterMode(meta)
    }
    return modes
  })

  return { columnMetaMap, columnFilterModes }
}
