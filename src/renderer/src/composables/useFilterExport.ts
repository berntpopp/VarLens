import { type Ref } from 'vue'
import { useApiService } from './useApiService'
import { buildFilterFromState, type FilterState, type ExportResult } from './filter-types'
import { logService } from '../services/LogService'
import { isIpcError, unwrapIpcResult } from '../../../shared/types/errors'
import { getCurrentUnsupportedReason } from '../utils/backend-capabilities'
import type { ExportFormat } from '../../../shared/ipc/domains/export'
import type { BatchAnnotationKey, Variant, VariantFilter } from '../../../shared/types/api'
import {
  formatSignOutTable,
  variantToSignOutRow,
  type SignOutRow
} from '../utils/sign-out-clipboard'

export { formatSignOutTable, variantToSignOutRow, type SignOutRow }

export interface CopySignOutResult {
  success: boolean
  count: number
  format?: 'markdown' | 'tsv'
  error?: string
}

async function getVariantExportBlockReason(): Promise<string | null> {
  return getCurrentUnsupportedReason('export.variants')
}

/**
 * Composable for variant export and clinical sign-out clipboard functionality.
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

      return result?.error === 'Export cancelled' || result?.cancelled === true
        ? { success: false, cancelled: true }
        : null
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : isIpcError(error)
            ? (error.userMessage ?? error.message)
            : String(error)
      logService.error('Export error: ' + message, 'export')
      return { success: false, error: message }
    } finally {
      exporting.value = false
    }
  }

  const copySignOutTable = async (
    caseId: number,
    format: 'markdown' | 'tsv'
  ): Promise<CopySignOutResult> => {
    if (!api) {
      logService.warn('API not available - running outside Electron', 'export')
      return { success: false, count: 0, error: 'API not available' }
    }

    if (typeof navigator?.clipboard?.writeText !== 'function') {
      return { success: false, count: 0, error: 'Clipboard API not available' }
    }

    try {
      const fetchAllVariants = async (
        filter: Omit<VariantFilter, 'case_id'>
      ): Promise<Variant[]> => {
        const PAGE_SIZE = 500
        let offset = 0
        const all: Variant[] = []

        while (true) {
          const res = await api.variants.query(caseId, filter, offset, PAGE_SIZE)
          const result = unwrapIpcResult(res)
          const rows = result?.data ?? []
          all.push(...rows)
          const total = result?.total_count ?? all.length
          if (rows.length === 0 || all.length >= total) {
            break
          }
          offset += rows.length
        }

        return all
      }

      const [starredVariants, acmgVariants] = await Promise.all([
        fetchAllVariants({ starred_only: true, annotation_scope: 'all' } as Omit<
          VariantFilter,
          'case_id'
        >),
        fetchAllVariants({
          acmg_classifications: ['Pathogenic', 'Likely pathogenic'],
          annotation_scope: 'all'
        } as Omit<VariantFilter, 'case_id'>)
      ])

      const seen = new Set<number>()
      const deduped: Variant[] = []
      for (const v of [...starredVariants, ...acmgVariants]) {
        if (!seen.has(v.id)) {
          seen.add(v.id)
          deduped.push(v)
        }
      }

      if (deduped.length === 0) {
        return {
          success: false,
          count: 0,
          error: 'No starred or Pathogenic / Likely pathogenic variants found for this case.'
        }
      }

      const keys: BatchAnnotationKey[] = deduped.map((v) => ({
        variantId: v.id,
        chr: v.chr,
        pos: v.pos,
        ref: v.ref,
        alt: v.alt
      }))

      const annotRes = await api.annotations.batchGet(caseId, keys)
      const annotationsMap = unwrapIpcResult(annotRes) ?? {}

      const rows: SignOutRow[] = deduped.map((v) => {
        const annot = annotationsMap[`${v.chr}:${v.pos}:${v.ref}:${v.alt}`]
        return variantToSignOutRow(v, annot)
      })

      const text = formatSignOutTable(rows, format)
      await navigator.clipboard.writeText(text)

      return { success: true, count: deduped.length, format }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : isIpcError(error)
            ? (error.userMessage ?? error.message)
            : String(error)
      logService.error('Copy sign-out error: ' + message, 'export')
      return { success: false, count: 0, error: message }
    }
  }

  return { exportToExcel, copySignOutTable }
}
