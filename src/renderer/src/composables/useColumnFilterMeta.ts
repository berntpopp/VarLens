import { computed, type Ref } from 'vue'
import type { ColumnFilterMeta, ColumnFilterMode } from '../../../shared/types/column-filters'
import { detectFilterMode } from '../config/columnFilterConfig'

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
    for (const meta of columnMeta.value) {
      modes[meta.key] = detectFilterMode(meta)
    }
    return modes
  })

  return { columnMetaMap, columnFilterModes }
}
