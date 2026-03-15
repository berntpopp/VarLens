import { describe, it, expect } from 'vitest'
import { useColumnFilters } from '../../../src/renderer/src/composables/useColumnFilters'
import type { ColumnFilter } from '../../../src/shared/types/column-filters'

describe('useColumnFilters', () => {
  it('starts with no active filters', () => {
    const { hasActiveFilters, activeFilterCount, getColumnFiltersParam } = useColumnFilters()
    expect(hasActiveFilters.value).toBe(false)
    expect(activeFilterCount.value).toBe(0)
    expect(getColumnFiltersParam()).toBeUndefined()
  })

  it('setColumnFilter adds a typed filter', () => {
    const { setColumnFilter, hasFilter, hasActiveFilters, activeFilterCount, columnFilters } =
      useColumnFilters()

    const filter: ColumnFilter = { operator: 'like', value: 'BRCA' }
    setColumnFilter('gene_symbol', filter)
    expect(hasFilter('gene_symbol')).toBe(true)
    expect(hasActiveFilters.value).toBe(true)
    expect(activeFilterCount.value).toBe(1)
    expect(columnFilters.value.gene_symbol).toEqual(filter)
  })

  it('setColumnFilter with null removes the filter', () => {
    const { setColumnFilter, hasFilter, hasActiveFilters } = useColumnFilters()

    setColumnFilter('gene_symbol', { operator: 'like', value: 'BRCA' })
    expect(hasFilter('gene_symbol')).toBe(true)

    setColumnFilter('gene_symbol', null)
    expect(hasFilter('gene_symbol')).toBe(false)
    expect(hasActiveFilters.value).toBe(false)
  })

  it('clearColumnFilter removes a specific filter', () => {
    const { setColumnFilter, clearColumnFilter, hasFilter, activeFilterCount } = useColumnFilters()

    setColumnFilter('gene_symbol', { operator: 'like', value: 'BRCA' })
    setColumnFilter('chr', { operator: '=', value: '1' })
    expect(activeFilterCount.value).toBe(2)

    clearColumnFilter('gene_symbol')
    expect(hasFilter('gene_symbol')).toBe(false)
    expect(hasFilter('chr')).toBe(true)
    expect(activeFilterCount.value).toBe(1)
  })

  it('clearAllColumnFilters removes all filters', () => {
    const { setColumnFilter, clearAllColumnFilters, hasActiveFilters, activeFilterCount } =
      useColumnFilters()

    setColumnFilter('gene_symbol', { operator: 'like', value: 'BRCA' })
    setColumnFilter('chr', { operator: '=', value: '1' })
    setColumnFilter('clinvar', { operator: 'in', value: ['Pathogenic'] })
    expect(activeFilterCount.value).toBe(3)

    clearAllColumnFilters()
    expect(hasActiveFilters.value).toBe(false)
    expect(activeFilterCount.value).toBe(0)
  })

  it('getColumnFiltersParam returns undefined when no active filters', () => {
    const { getColumnFiltersParam } = useColumnFilters()
    expect(getColumnFiltersParam()).toBeUndefined()
  })

  it('getColumnFiltersParam returns all filters', () => {
    const { setColumnFilter, getColumnFiltersParam } = useColumnFilters()

    setColumnFilter('gene_symbol', { operator: 'like', value: 'BRCA' })
    setColumnFilter('chr', { operator: '=', value: '1' })

    const result = getColumnFiltersParam()
    expect(result).toEqual({
      gene_symbol: { operator: 'like', value: 'BRCA' },
      chr: { operator: '=', value: '1' }
    })
  })

  it('hasFilter returns false for unknown columns', () => {
    const { hasFilter } = useColumnFilters()
    expect(hasFilter('nonexistent')).toBe(false)
  })

  it('multiple setColumnFilter calls update correctly', () => {
    const { setColumnFilter, columnFilters } = useColumnFilters()

    setColumnFilter('gene_symbol', { operator: 'like', value: 'BRCA' })
    setColumnFilter('gene_symbol', { operator: 'like', value: 'TP53' })
    expect(columnFilters.value.gene_symbol).toEqual({ operator: 'like', value: 'TP53' })
  })

  it('getFilter returns filter for existing key', () => {
    const { setColumnFilter, getFilter } = useColumnFilters()

    const filter: ColumnFilter = { operator: '>=', value: 20 }
    setColumnFilter('cadd', filter)
    expect(getFilter('cadd')).toEqual(filter)
  })

  it('getFilter returns undefined for non-existent key', () => {
    const { getFilter } = useColumnFilters()
    expect(getFilter('nonexistent')).toBeUndefined()
  })

  it('supports numeric operator filters', () => {
    const { setColumnFilter, getFilter, getColumnFiltersParam } = useColumnFilters()

    setColumnFilter('cadd', { operator: '>=', value: 20 })
    setColumnFilter('gnomad_af', { operator: '<=', value: 0.01 })

    expect(getFilter('cadd')).toEqual({ operator: '>=', value: 20 })
    expect(getFilter('gnomad_af')).toEqual({ operator: '<=', value: 0.01 })

    const params = getColumnFiltersParam()
    expect(params).toEqual({
      cadd: { operator: '>=', value: 20 },
      gnomad_af: { operator: '<=', value: 0.01 }
    })
  })

  it('supports categorical in-operator filters', () => {
    const { setColumnFilter, getFilter } = useColumnFilters()

    setColumnFilter('consequence', { operator: 'in', value: ['missense', 'nonsense'] })
    expect(getFilter('consequence')).toEqual({
      operator: 'in',
      value: ['missense', 'nonsense']
    })
  })
})
