import { type Ref } from 'vue'
import { useApiService } from './useApiService'
import { buildFilterFromState, type FilterState, type ExportResult } from './filter-types'
import { logService } from '../services/LogService'
import { isIpcError, unwrapIpcResult } from '../../../shared/types/errors'
import { getCurrentUnsupportedReason } from '../utils/backend-capabilities'
import type { ExportFormat } from '../../../shared/ipc/domains/export'
import type { VariantFilter } from '../../../shared/types/api'

async function getVariantExportBlockReason(): Promise<string | null> {
  return getCurrentUnsupportedReason('export.variants')
}

/**
 * Composable for variant export functionality.
 * Extracted from useFilterState to separate export concerns.
 */
export function useFilterExport(
  filters: Ref<FilterState>,
  selectedImpactPresets: Ref<string[]>,
  exporting: Ref<boolean>
) {
  const { api } = useApiService()

  const exportToExcel = async (
    caseId: number,
    caseName: string,
    format?: ExportFormat,
    // The filters of the table query (tab type, DSL and header column filters)
    tableFilters?: Omit<VariantFilter, 'case_id'>
  ): Promise<ExportResult | null> => {
    if (!api) {
      logService.warn('API not available - running outside Electron', 'export')
      return null
    }

    const reason = await getVariantExportBlockReason()
    if (reason !== null) {
      logService.warn(reason, 'backend-capabilities')
      return { success: false, error: reason }
    }

    exporting.value = true
    try {
      const exportFilters =
        tableFilters ?? buildFilterFromState(filters.value, selectedImpactPresets.value)

      const result = unwrapIpcResult(
        await api.export.variants(
          caseId,
          exportFilters,
          caseName !== '' ? caseName : `case_${caseId}`,
          format === undefined ? undefined : { format }
        )
      )

      if (result !== null && result !== undefined && result.success === true) {
        return { success: true, filePath: result.filePath }
      } else if (
        result !== null &&
        result !== undefined &&
        typeof result.error === 'string' &&
        result.error !== 'Export cancelled'
      ) {
        return { success: false, error: result.error }
      }

      return result?.error === 'Export cancelled' ? { success: false, cancelled: true } : null
    } catch (error) {
      logService.error(
        'Export error: ' +
          (error instanceof Error
            ? error.message
            : isIpcError(error)
              ? (error.userMessage ?? error.message)
              : String(error)),
        'export'
      )
      return null
    } finally {
      exporting.value = false
    }
  }

  return { exportToExcel }
}
