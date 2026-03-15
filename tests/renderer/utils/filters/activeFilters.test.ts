import { describe, it, expect } from 'vitest'
import { buildActiveFiltersList } from '../../../../src/renderer/src/utils/filters/activeFilters'
import type { FilterState } from '../../../../src/shared/types/filters'

function makeDefaultFilters(overrides: Partial<FilterState> = {}): FilterState {
  return {
    searchQuery: '',
    geneSymbol: '',
    consequences: [],
    funcs: [],
    clinvars: [],
    maxGnomadAf: null,
    minCadd: null,
    minCohortFrequency: null,
    minCarriers: null,
    starredOnly: false,
    hasCommentOnly: false,
    acmgClassifications: [],
    ...overrides
  }
}

describe('buildActiveFiltersList', () => {
  it('returns empty array when no filters active', () => {
    expect(buildActiveFiltersList(makeDefaultFilters())).toEqual([])
  })

  it('formats AF filter with operator in value', () => {
    const result = buildActiveFiltersList(makeDefaultFilters({ maxGnomadAf: 0.01 }))
    const af = result.find((f) => f.id === 'frequency')
    expect(af).toBeDefined()
    expect(af!.label).toBe('AF')
    expect(af!.value).toBe('<= 1.00%')
  })

  it('formats CADD filter with operator in value', () => {
    const result = buildActiveFiltersList(makeDefaultFilters({ minCadd: 20 }))
    const cadd = result.find((f) => f.id === 'cadd')
    expect(cadd).toBeDefined()
    expect(cadd!.label).toBe('CADD')
    expect(cadd!.value).toBe('>= 20')
  })

  it('includes search filter', () => {
    const result = buildActiveFiltersList(makeDefaultFilters({ searchQuery: 'BRCA1' }))
    expect(result).toContainEqual({ id: 'search', label: 'Search', value: 'BRCA1' })
  })

  it('includes gene filter', () => {
    const result = buildActiveFiltersList(makeDefaultFilters({ geneSymbol: 'TP53' }))
    expect(result).toContainEqual({ id: 'gene', label: 'Gene', value: 'TP53' })
  })

  it('includes impact presets', () => {
    const result = buildActiveFiltersList(makeDefaultFilters(), ['HIGH', 'MODERATE'])
    expect(result).toContainEqual({ id: 'impact', label: 'Impact', value: 'HIGH, MODERATE' })
  })

  it('includes starred filter', () => {
    const result = buildActiveFiltersList(makeDefaultFilters({ starredOnly: true }))
    expect(result).toContainEqual({ id: 'starred', label: 'Starred', value: 'only' })
  })

  it('includes ACMG filter', () => {
    const result = buildActiveFiltersList(
      makeDefaultFilters({ acmgClassifications: ['Pathogenic', 'Likely pathogenic'] })
    )
    const acmg = result.find((f) => f.id === 'acmg')
    expect(acmg).toBeDefined()
    expect(acmg!.value).toBe('Pathogenic, Likely pathogenic')
  })
})
