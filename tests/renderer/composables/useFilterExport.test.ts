import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FILTER_DEFAULTS } from '../../../src/shared/filters/filterDefaults'
import type { FilterState } from '../../../src/shared/types/filters'

const exportVariants = vi.fn()

vi.mock('../../../src/renderer/src/composables/useApiService', () => ({
  useApiService: () => ({ api: { export: { variants: exportVariants } } })
}))

vi.mock('../../../src/renderer/src/utils/backend-capabilities', () => ({
  getCurrentUnsupportedReason: async () => null
}))

import { useFilterExport } from '../../../src/renderer/src/composables/useFilterExport'

describe('useFilterExport', () => {
  beforeEach(() => {
    exportVariants.mockReset()
    exportVariants.mockResolvedValue({ success: true, filePath: '/tmp/case.xlsx' })
  })

  // #485: the exported file must contain exactly the rows the table shows.
  it('exports with the filters of the table query when they are given', async () => {
    const { exportToExcel } = useFilterExport(
      ref({ ...FILTER_DEFAULTS } as FilterState),
      ref([]),
      ref(false)
    )
    const tableFilters = {
      variant_type: 'sv',
      starred_only: true,
      active_panel_ids: [7],
      column_filters: { cadd_phred: { operator: '>=' as const, value: 25 } }
    }

    await exportToExcel(1, 'Case A', undefined, tableFilters)

    expect(exportVariants.mock.calls[0][1]).toEqual(tableFilters)
  })
})
