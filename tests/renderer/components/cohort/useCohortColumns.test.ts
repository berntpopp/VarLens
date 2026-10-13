import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import {
  SNV_ONLY_COHORT_COLUMNS,
  useCohortColumns
} from '../../../../src/renderer/src/components/cohort/useCohortColumns'
import { svHeaders } from '../../../../src/renderer/src/components/variant-table/sv-columns'
import { cnvHeaders } from '../../../../src/renderer/src/components/variant-table/cnv-columns'

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

describe('useCohortColumns SV/CNV call columns (#573)', () => {
  beforeEach(() => setActivePinia(createPinia()))

  const prefs = ref({ order: [] as string[], visibility: {} as Record<string, boolean> })
  const keysOf = (type: string): string[] =>
    useCohortColumns(prefs, () => type).orderedColumns.value.map((c) => c.key)

  it.each([
    ['sv', svHeaders],
    ['cnv', cnvHeaders]
  ])('shows the case %s End/Type/Length columns right after Position', (type, caseHeaders) => {
    const columns = useCohortColumns(prefs, () => type).orderedColumns.value
    const keys = columns.map((c) => c.key)
    expect(keys.slice(keys.indexOf('pos') + 1, keys.indexOf('pos') + 4)).toEqual([
      'end_pos',
      'sv_type',
      'sv_length'
    ])
    for (const key of ['end_pos', 'sv_type', 'sv_length']) {
      const cohort = columns.find((c) => c.key === key)!
      const caseColumn = caseHeaders.find((c) => c.key === key)!
      expect(cohort).toBe(caseColumn)
      expect(cohort.sortable).toBe(true)
    }
    const length = columns.find((c) => c.key === 'sv_length')!
    expect((length.value as (item: unknown) => string)({ sv_length: -12_345 })).toBe('12.35 kb')
  })

  it.each(['snv', 'str'])('has no call columns on the %s tab', (type) => {
    const keys = keysOf(type)
    for (const key of ['end_pos', 'sv_type', 'sv_length']) expect(keys).not.toContain(key)
  })
})
