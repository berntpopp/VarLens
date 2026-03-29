import { describe, it, expect } from 'vitest'
import { FILTER_DEFAULTS } from '../../../../src/renderer/src/utils/filters/filterDefaults'

describe('FILTER_DEFAULTS', () => {
  it('is frozen (immutable)', () => {
    expect(Object.isFrozen(FILTER_DEFAULTS)).toBe(true)
  })

  it('has null for all numeric filters', () => {
    expect(FILTER_DEFAULTS.maxGnomadAf).toBeNull()
    expect(FILTER_DEFAULTS.minCadd).toBeNull()
    expect(FILTER_DEFAULTS.maxInternalAf).toBeNull()
    expect(FILTER_DEFAULTS.minCarriers).toBeNull()
  })

  it('has empty arrays for all array filters', () => {
    expect(FILTER_DEFAULTS.consequences).toEqual([])
    expect(FILTER_DEFAULTS.funcs).toEqual([])
    expect(FILTER_DEFAULTS.clinvars).toEqual([])
    expect(FILTER_DEFAULTS.acmgClassifications).toEqual([])
    expect(FILTER_DEFAULTS.activePanelIds).toEqual([])
    expect(FILTER_DEFAULTS.inheritanceModes).toEqual([])
  })

  it('has empty strings for text filters', () => {
    expect(FILTER_DEFAULTS.geneSymbol).toBe('')
    expect(FILTER_DEFAULTS.searchQuery).toBe('')
  })

  it('has false for boolean filters', () => {
    expect(FILTER_DEFAULTS.starredOnly).toBe(false)
    expect(FILTER_DEFAULTS.hasCommentOnly).toBe(false)
    expect(FILTER_DEFAULTS.considerPhasing).toBe(false)
  })

  it('has null for analysisGroupId', () => {
    expect(FILTER_DEFAULTS.analysisGroupId).toBeNull()
  })

  it('has 5000 for panelPaddingBp', () => {
    expect(FILTER_DEFAULTS.panelPaddingBp).toBe(5000)
  })

  it('includes all expected keys', () => {
    const expectedKeys = [
      'geneSymbol',
      'searchQuery',
      'consequences',
      'funcs',
      'clinvars',
      'maxGnomadAf',
      'minCadd',
      'minCarriers',
      'starredOnly',
      'hasCommentOnly',
      'acmgClassifications',
      'activePanelIds',
      'panelPaddingBp',
      'maxInternalAf',
      'inheritanceModes',
      'analysisGroupId',
      'considerPhasing'
    ].sort()
    expect(Object.keys(FILTER_DEFAULTS).sort()).toEqual(expectedKeys)
  })
})
