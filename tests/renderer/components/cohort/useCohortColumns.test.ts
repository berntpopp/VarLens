import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import {
  SNV_ONLY_COHORT_COLUMNS,
  useCohortColumns
} from '../../../../src/renderer/src/components/cohort/useCohortColumns'

vi.mock('../../../../src/renderer/src/composables/useResponsiveLayout', () => ({
  useAutoHiddenColumns: () => ({ isVisible: () => true })
}))

describe('useCohortColumns per variant type', () => {
  beforeEach(() => setActivePinia(createPinia()))

  const prefs = ref({ order: [] as string[], visibility: {} as Record<string, boolean> })

  it.each(['sv', 'cnv', 'str'])('drops SNV-only columns on the %s tab', (type) => {
    const { orderedColumns } = useCohortColumns(prefs, () => type)
    const keys = orderedColumns.value.map((c) => c.key)
    for (const key of SNV_ONLY_COHORT_COLUMNS) expect(keys).not.toContain(key)
    expect(keys).toContain('alt')
  })

  it('keeps every SNV-only column on the SNV/indel tab', () => {
    const { orderedColumns } = useCohortColumns(prefs, () => 'snv')
    const keys = orderedColumns.value.map((c) => c.key)
    for (const key of SNV_ONLY_COHORT_COLUMNS) expect(keys).toContain(key)
  })
})
