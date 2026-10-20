import { afterEach, describe, expect, it } from 'vitest'
import { mockApi, resetMockData } from '../../../src/renderer/src/mocks/mockApi'
import { BUILT_IN_SHORTLIST_PRESETS } from '../../../src/shared/config/built-in-shortlist-presets'

describe('mockApi overview and presets', () => {
  afterEach(() => {
    resetMockData()
  })

  it('presets.list returns canonical built-in shortlist presets', async () => {
    const presets = await mockApi.presets.list()
    expect(presets).toHaveLength(BUILT_IN_SHORTLIST_PRESETS.length)
    expect(presets.map((p) => p.name)).toEqual(BUILT_IN_SHORTLIST_PRESETS.map((p) => p.name))
    expect(presets.map((p) => p.sortOrder)).toEqual(
      BUILT_IN_SHORTLIST_PRESETS.map((p) => p.sortOrder)
    )

    for (let i = 0; i < BUILT_IN_SHORTLIST_PRESETS.length; i++) {
      const canonical = BUILT_IN_SHORTLIST_PRESETS[i]
      const preset = presets[i]
      expect(preset.name).toBe(canonical.name)
      expect(preset.description).toBe(canonical.description)
      expect(preset.isBuiltIn).toBe(true)
      expect(preset.kind).toBe('shortlist')
      expect((preset.filterJson as { shortlist: unknown }).shortlist).toEqual(canonical.config)
    }
  })

  it('database.getOverview reports active counts and does not populate acmg_counts from clinvar', async () => {
    const initialOverview = await mockApi.database.getOverview()
    expect(initialOverview.summary.total_cases).toBeGreaterThan(0)
    expect(initialOverview.summary.total_variants).toBeGreaterThan(0)
    expect(initialOverview.cases).toHaveLength(initialOverview.summary.total_cases)

    // ACMG counts in cohort summary must remain 0 (mock has no ACMG classifier annotations,
    // and must not heuristically populate acmg_counts from clinvar strings)
    expect(initialOverview.summary.acmg_counts).toEqual({
      pathogenic: 0,
      likely_pathogenic: 0,
      vus: 0,
      likely_benign: 0,
      benign: 0
    })

    // Delete all cases and verify cascade to variants in overview and cohort summary
    await mockApi.cases.deleteAll()

    const clearedOverview = await mockApi.database.getOverview()
    expect(clearedOverview.summary.total_cases).toBe(0)
    expect(clearedOverview.summary.total_variants).toBe(0)
    expect(clearedOverview.summary.unique_variants).toBe(0)
    expect(clearedOverview.cases).toHaveLength(0)

    const cohortSummary = await mockApi.cohort.getSummary()
    expect(cohortSummary.total_cases).toBe(0)
    expect(cohortSummary.total_variants).toBe(0)
    expect(cohortSummary.unique_variants).toBe(0)
  })

  it('presets.reorder mutates sort order and resetMockPresets restores defaults cleanly', async () => {
    const original = await mockApi.presets.list()
    expect(original[0].sortOrder).toBe(0)
    expect(original[1].sortOrder).toBe(1)

    // Swap sort orders
    await mockApi.presets.reorder([
      { id: original[0].id, sortOrder: 99 },
      { id: original[1].id, sortOrder: 100 }
    ])

    const mutated = await mockApi.presets.list()
    expect(mutated.find((p) => p.id === original[0].id)?.sortOrder).toBe(99)
    expect(mutated.find((p) => p.id === original[1].id)?.sortOrder).toBe(100)

    // Reset and verify defaults restored without leaking mutated values
    resetMockData()
    const restored = await mockApi.presets.list()
    expect(restored[0].sortOrder).toBe(0)
    expect(restored[1].sortOrder).toBe(1)
  })
})
