import { describe, expect, it } from 'vitest'
import { createFilterState } from '../../../../src/shared/filters/filterDefaults'
import {
  decodeFilterSnapshot,
  decodeSort,
  encodeFilterSnapshot,
  encodeSort,
  parsePositiveInt,
  parseVisibleTab
} from '../../../../src/renderer/src/utils/url-state/view-query'

describe('sort codec', () => {
  it('round-trips multi-key sorts with direction', () => {
    const encoded = encodeSort([
      { key: 'gene_symbol', order: 'asc' },
      { key: 'pos', order: 'desc' }
    ])
    expect(encoded).toBe('gene_symbol,-pos')
    expect(decodeSort(encoded)).toEqual([
      { key: 'gene_symbol', order: 'asc' },
      { key: 'pos', order: 'desc' }
    ])
  })

  it('omits the key when unsorted and rejects hostile keys', () => {
    expect(encodeSort([])).toBeUndefined()
    expect(decodeSort('pos,-gene;drop table,<script>,cadd')).toEqual([
      { key: 'pos', order: 'asc' },
      { key: 'cadd', order: 'asc' }
    ])
    expect(decodeSort(undefined)).toEqual([])
  })

  it('keeps dotted extension keys (SV/STR columns)', () => {
    expect(decodeSort('-sv.svlen')).toEqual([{ key: 'sv.svlen', order: 'desc' }])
  })
})

describe('filter snapshot codec', () => {
  it('serialises only the diff against defaults, without search text', () => {
    const state = createFilterState({
      consequences: ['HIGH'],
      maxGnomadAf: 0.001,
      starredOnly: true,
      searchQuery: 'BRCA1'
    })
    const encoded = encodeFilterSnapshot(state, ['MODERATE'])
    expect(JSON.parse(encoded!)).toEqual({
      consequences: ['HIGH'],
      maxGnomadAf: 0.001,
      starredOnly: true,
      i: ['MODERATE']
    })
  })

  it('omits the key entirely for default filters', () => {
    expect(encodeFilterSnapshot(createFilterState(), [])).toBeUndefined()
  })

  it('round-trips through decode', () => {
    const state = createFilterState({ clinvars: ['Pathogenic'], minCadd: 20, tagIds: [3] })
    const decoded = decodeFilterSnapshot(encodeFilterSnapshot(state, ['HIGH']))
    expect(decoded.state).toEqual({ clinvars: ['Pathogenic'], minCadd: 20, tagIds: [3] })
    expect(decoded.impact).toEqual(['HIGH'])
  })

  it('drops unknown keys, wrong types and malformed JSON', () => {
    const decoded = decodeFilterSnapshot(
      JSON.stringify({
        consequences: 'HIGH',
        minCadd: '20',
        starredOnly: true,
        __proto__x: 1,
        searchQuery: 'x',
        columnFilters: [1]
      })
    )
    expect(decoded.state).toEqual({ starredOnly: true })
    expect(decodeFilterSnapshot('{not json').state).toEqual({})
    expect(decodeFilterSnapshot('[1,2]').state).toEqual({})
  })
})

describe('scalar params', () => {
  it('parses positive case ids only', () => {
    expect(parsePositiveInt('12')).toBe(12)
    expect(parsePositiveInt('0')).toBeNull()
    expect(parsePositiveInt('-3')).toBeNull()
    expect(parsePositiveInt('1e3')).toBeNull()
    expect(parsePositiveInt(undefined)).toBeNull()
  })

  it('accepts only known variant tabs', () => {
    expect(parseVisibleTab('shortlist')).toBe('shortlist')
    expect(parseVisibleTab('str')).toBe('str')
    expect(parseVisibleTab('cohort')).toBeNull()
  })
})
