import { describe, it, expect } from 'vitest'
import {
  clearFilter,
  clearAllFilters
} from '../../../../src/renderer/src/utils/filters/filterClearing'
import { FILTER_DEFAULTS } from '../../../../src/renderer/src/utils/filters/filterDefaults'

describe('clearFilter', () => {
  // --- Internal AF clearing ---

  describe('internal-frequency', () => {
    it('returns maxInternalAf reset to default', () => {
      const result = clearFilter('internal-frequency')
      expect(result).toEqual({ maxInternalAf: null })
    })
  })

  // --- Inheritance clearing ---

  describe('inheritance', () => {
    it('returns all three inheritance fields reset to defaults', () => {
      const result = clearFilter('inheritance')
      expect(result).toEqual({
        inheritanceModes: [],
        analysisGroupId: null,
        considerPhasing: false
      })
    })

    it('returns fresh array (not the frozen default)', () => {
      const result = clearFilter('inheritance')
      expect(result.inheritanceModes).not.toBe(FILTER_DEFAULTS.inheritanceModes)
      expect(result.inheritanceModes).toEqual([])
    })
  })

  // --- Existing filter IDs still work ---

  describe('existing filters still work', () => {
    it('clears search', () => {
      expect(clearFilter('search')).toEqual({ searchQuery: '' })
    })

    it('clears frequency', () => {
      expect(clearFilter('frequency')).toEqual({ maxGnomadAf: null })
    })

    it('clears panels with both fields', () => {
      const result = clearFilter('panels')
      expect(result).toHaveProperty('activePanelIds')
      expect(result).toHaveProperty('panelPaddingBp')
    })
  })
})

describe('clearAllFilters', () => {
  it('returns a complete FilterState with all defaults', () => {
    const result = clearAllFilters()

    // Check new fields specifically
    expect(result.maxInternalAf).toBeNull()
    expect(result.inheritanceModes).toEqual([])
    expect(result.analysisGroupId).toBeNull()
    expect(result.considerPhasing).toBe(false)

    // Check it includes all existing fields too
    expect(result.searchQuery).toBe('')
    expect(result.geneSymbol).toBe('')
    expect(result.consequences).toEqual([])
    expect(result.maxGnomadAf).toBeNull()
    expect(result.starredOnly).toBe(false)
    expect(result.acmgClassifications).toEqual([])
    expect(result.activePanelIds).toEqual([])
  })

  it('returns fresh arrays (not frozen defaults)', () => {
    const result = clearAllFilters()
    expect(result.inheritanceModes).not.toBe(FILTER_DEFAULTS.inheritanceModes)
    expect(result.consequences).not.toBe(FILTER_DEFAULTS.consequences)
    expect(result.activePanelIds).not.toBe(FILTER_DEFAULTS.activePanelIds)
  })

  it('returns a new object each time', () => {
    const a = clearAllFilters()
    const b = clearAllFilters()
    expect(a).not.toBe(b)
    expect(a).toEqual(b)
  })

  it('has all keys matching FILTER_DEFAULTS', () => {
    const result = clearAllFilters()
    const defaultKeys = Object.keys(FILTER_DEFAULTS).sort()
    const resultKeys = Object.keys(result).sort()
    expect(resultKeys).toEqual(defaultKeys)
  })
})
