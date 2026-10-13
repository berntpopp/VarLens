import { describe, it, expect, vi, afterEach } from 'vitest'
import { ref } from 'vue'
import {
  tableViewportWidthPx,
  useAutoHiddenColumns
} from '@renderer/composables/useResponsiveLayout'
import { LINKS_COLUMN_KEY } from '@renderer/utils/link-outs'
import { COLUMN_PRIORITY, MIN_AUTO_VISIBLE_COLUMNS } from '@renderer/config/columnPriority'
import { columnWidthRem } from '@renderer/components/variant-table/column-widths'

vi.mock('vuetify', () => ({ useDisplay: () => ({ width: ref(1920) }) }))
vi.mock('@renderer/composables/useRootFontSize', () => ({ readRootFontPx: () => 16 }))

describe('useAutoHiddenColumns', () => {
  afterEach(() => {
    tableViewportWidthPx.value = null
  })

  it("sizes the Links column by its header's width, not the default column width", () => {
    // The always-kept top columns, then 12rem left: fits the 8.75rem default
    // but not the 16.5rem a 9-link column needs.
    const top = Object.entries(COLUMN_PRIORITY)
      .sort((a, b) => a[1] - b[1])
      .slice(0, MIN_AUTO_VISIBLE_COLUMNS)
      .map(([key]) => key)
    const topRem = top.reduce((sum, key) => sum + columnWidthRem(key), 0)
    tableViewportWidthPx.value = (topRem + 12) * 16
    const prefs = ref({ visibility: {} })
    const columns = [...top.map((key) => ({ key })), { key: LINKS_COLUMN_KEY, width: '16.5rem' }]
    const { autoHidden } = useAutoHiddenColumns(columns, prefs)
    expect(autoHidden.value.has(LINKS_COLUMN_KEY)).toBe(true)
  })
})
