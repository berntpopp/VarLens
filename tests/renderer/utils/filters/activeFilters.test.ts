import { describe, it, expect } from 'vitest'
import { buildActiveFiltersList } from '../../../../src/renderer/src/utils/filters/activeFilters'
import type { FilterState } from '../../../../src/shared/types/filters'
import type { ColumnFiltersParam } from '../../../../src/shared/types/column-filters'

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

  // Column filter chip tests
  describe('column filter chips', () => {
    it('adds chip for numeric column filter with >= operator', () => {
      const columnFilters: ColumnFiltersParam = {
        cadd_phred: { operator: '>=', value: 20 }
      }
      const result = buildActiveFiltersList(makeDefaultFilters(), [], columnFilters)
      const chip = result.find((f) => f.id === 'col:cadd_phred')
      expect(chip).toBeDefined()
      expect(chip!.label).toBe('CADD')
      expect(chip!.value).toBe('>= 20')
    })

    it('adds chip for numeric column filter with <= operator', () => {
      const columnFilters: ColumnFiltersParam = {
        gnomad_af: { operator: '<=', value: 0.01 }
      }
      const result = buildActiveFiltersList(makeDefaultFilters(), [], columnFilters)
      const chip = result.find((f) => f.id === 'col:gnomad_af')
      expect(chip).toBeDefined()
      expect(chip!.label).toBe('gnomAD AF')
      expect(chip!.value).toBe('<= 0.01')
    })

    it('adds chip for categorical column filter with in operator', () => {
      const columnFilters: ColumnFiltersParam = {
        consequence: { operator: 'in', value: ['missense', 'nonsense', 'frameshift'] }
      }
      const result = buildActiveFiltersList(makeDefaultFilters(), [], columnFilters)
      const chip = result.find((f) => f.id === 'col:consequence')
      expect(chip).toBeDefined()
      expect(chip!.label).toBe('Consequence')
      expect(chip!.value).toBe('3 selected')
    })

    it('adds chip for text column filter with like operator', () => {
      const columnFilters: ColumnFiltersParam = {
        gene_symbol: { operator: 'like', value: 'BRCA' }
      }
      const result = buildActiveFiltersList(makeDefaultFilters(), [], columnFilters)
      const chip = result.find((f) => f.id === 'col:gene_symbol')
      expect(chip).toBeDefined()
      expect(chip!.label).toBe('Gene')
      expect(chip!.value).toBe('~ BRCA')
    })

    it('adds chips for multiple column filters', () => {
      const columnFilters: ColumnFiltersParam = {
        cadd_phred: { operator: '>=', value: 15 },
        chr: { operator: '=', value: '1' },
        consequence: { operator: 'in', value: ['missense'] }
      }
      const result = buildActiveFiltersList(makeDefaultFilters(), [], columnFilters)
      const colChips = result.filter((f) => f.id.startsWith('col:'))
      expect(colChips).toHaveLength(3)
    })

    it('uses column key as label for unknown columns', () => {
      const columnFilters: ColumnFiltersParam = {
        custom_field: { operator: '=', value: 'test' }
      }
      const result = buildActiveFiltersList(makeDefaultFilters(), [], columnFilters)
      const chip = result.find((f) => f.id === 'col:custom_field')
      expect(chip).toBeDefined()
      expect(chip!.label).toBe('custom_field')
      expect(chip!.value).toBe('= test')
    })

    it('column filter chips appear after standard filter chips', () => {
      const columnFilters: ColumnFiltersParam = {
        gene_symbol: { operator: 'like', value: 'BRCA' }
      }
      const result = buildActiveFiltersList(
        makeDefaultFilters({ searchQuery: 'test' }),
        [],
        columnFilters
      )
      expect(result.length).toBe(2)
      expect(result[0].id).toBe('search')
      expect(result[1].id).toBe('col:gene_symbol')
    })

    it('returns empty when columnFilters is empty object', () => {
      const result = buildActiveFiltersList(makeDefaultFilters(), [], {})
      expect(result).toEqual([])
    })
  })
})
