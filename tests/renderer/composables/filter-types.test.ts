import { describe, it, expect } from 'vitest'
import { ref, isReactive } from 'vue'
import {
  buildFilterFromState,
  type FilterState
} from '../../../src/renderer/src/composables/filter-types'

const defaultState: FilterState = {
  searchQuery: '',
  geneSymbol: '',
  consequences: [],
  funcs: [],
  clinvars: [],
  maxGnomadAf: null,
  minCadd: null,
  tagIds: [],
  starredOnly: false,
  hasCommentOnly: false,
  acmgClassifications: [],
  annotationScope: 'case',
  activePanelIds: [],
  panelPaddingBp: 5000,
  maxInternalAf: null,
  inheritanceModes: [],
  analysisGroupId: null,
  considerPhasing: false
}

describe('buildFilterFromState', () => {
  it('returns empty filter for default state', () => {
    const result = buildFilterFromState(defaultState, [])
    expect(result).toEqual({})
  })

  it('includes search query when set', () => {
    const state = { ...defaultState, searchQuery: 'BRCA1' }
    const result = buildFilterFromState(state, [])
    expect(result.search_query).toBe('BRCA1')
  })

  it('includes gene symbol when set', () => {
    const state = { ...defaultState, geneSymbol: 'TP53' }
    const result = buildFilterFromState(state, [])
    expect(result.gene_symbol).toBe('TP53')
  })

  it('combines impact presets with consequences and deduplicates', () => {
    const state = { ...defaultState, consequences: ['missense_variant'] }
    const result = buildFilterFromState(state, ['HIGH', 'missense_variant'])
    expect(result.consequences).toEqual(['HIGH', 'missense_variant'])
  })

  it('skips NaN gnomad_af', () => {
    const state = { ...defaultState, maxGnomadAf: NaN }
    const result = buildFilterFromState(state, [])
    expect(result.gnomad_af_max).toBeUndefined()
  })

  it('skips zero gnomad_af', () => {
    const state = { ...defaultState, maxGnomadAf: 0 }
    const result = buildFilterFromState(state, [])
    expect(result.gnomad_af_max).toBeUndefined()
  })

  it('includes valid gnomad_af', () => {
    const state = { ...defaultState, maxGnomadAf: 0.01 }
    const result = buildFilterFromState(state, [])
    expect(result.gnomad_af_max).toBe(0.01)
  })

  it('includes cadd_min when zero (valid threshold)', () => {
    const state = { ...defaultState, minCadd: 0 }
    const result = buildFilterFromState(state, [])
    expect(result.cadd_min).toBe(0)
  })

  it('includes annotation scope when set to all', () => {
    const state = { ...defaultState, annotationScope: 'all' as const }
    const result = buildFilterFromState(state, [])
    expect(result.annotation_scope).toBe('all')
  })

  it('omits annotation scope when case (default)', () => {
    const result = buildFilterFromState(defaultState, [])
    expect(result.annotation_scope).toBeUndefined()
  })

  it('includes all filter types simultaneously', () => {
    const state: FilterState = {
      searchQuery: 'test',
      geneSymbol: 'BRCA1',
      consequences: ['missense_variant'],
      funcs: ['exonic'],
      clinvars: ['pathogenic'],
      maxGnomadAf: 0.01,
      minCadd: 15,
      tagIds: [1, 2],
      starredOnly: true,
      hasCommentOnly: true,
      acmgClassifications: ['Pathogenic'],
      annotationScope: 'all',
      activePanelIds: [1, 3],
      panelPaddingBp: 10000,
      maxInternalAf: null,
      inheritanceModes: [],
      analysisGroupId: null,
      considerPhasing: false
    }
    const result = buildFilterFromState(state, ['HIGH'])

    expect(result.search_query).toBe('test')
    expect(result.gene_symbol).toBe('BRCA1')
    expect(result.consequences).toEqual(['HIGH', 'missense_variant'])
    expect(result.funcs).toEqual(['exonic'])
    expect(result.clinvars).toEqual(['pathogenic'])
    expect(result.gnomad_af_max).toBe(0.01)
    expect(result.cadd_min).toBe(15)
    expect(result.tag_ids).toEqual([1, 2])
    expect(result.starred_only).toBe(true)
    expect(result.has_comment).toBe(true)
    expect(result.acmg_classifications).toEqual(['Pathogenic'])
    expect(result.annotation_scope).toBe('all')
    expect(result.active_panel_ids).toEqual([1, 3])
    expect(result.panel_padding_bp).toBe(10000)
  })

  describe('IPC safety — output arrays are plain (not reactive proxies)', () => {
    it('funcs output is a new plain array, not a reference to input', () => {
      const state = ref<FilterState>({
        ...defaultState,
        funcs: ['exonic', 'intronic']
      })
      const result = buildFilterFromState(state.value, [])
      expect(result.funcs).toEqual(['exonic', 'intronic'])
      expect(result.funcs).not.toBe(state.value.funcs)
      expect(isReactive(result.funcs)).toBe(false)
    })

    it('clinvars output is a new plain array', () => {
      const state = ref<FilterState>({
        ...defaultState,
        clinvars: ['pathogenic']
      })
      const result = buildFilterFromState(state.value, [])
      expect(result.clinvars).not.toBe(state.value.clinvars)
      expect(isReactive(result.clinvars)).toBe(false)
    })

    it('tag_ids output is a new plain array', () => {
      const state = ref<FilterState>({
        ...defaultState,
        tagIds: [1, 2, 3]
      })
      const result = buildFilterFromState(state.value, [])
      expect(result.tag_ids).not.toBe(state.value.tagIds)
      expect(isReactive(result.tag_ids)).toBe(false)
    })

    it('acmg_classifications output is a new plain array', () => {
      const state = ref<FilterState>({
        ...defaultState,
        acmgClassifications: ['Pathogenic', 'Likely pathogenic']
      })
      const result = buildFilterFromState(state.value, [])
      expect(result.acmg_classifications).not.toBe(state.value.acmgClassifications)
      expect(isReactive(result.acmg_classifications)).toBe(false)
    })

    it('entire output can be JSON-serialized (simulates IPC)', () => {
      const state = ref<FilterState>({
        searchQuery: 'test',
        geneSymbol: 'BRCA1',
        consequences: ['missense_variant'],
        funcs: ['exonic'],
        clinvars: ['pathogenic'],
        maxGnomadAf: 0.01,
        minCadd: 15,
        tagIds: [1, 2],
        starredOnly: true,
        hasCommentOnly: true,
        acmgClassifications: ['Pathogenic'],
        annotationScope: 'all',
        activePanelIds: [1],
        panelPaddingBp: 5000,
        maxInternalAf: null,
        inheritanceModes: [],
        analysisGroupId: null,
        considerPhasing: false
      })
      const result = buildFilterFromState(state.value, ['HIGH'])
      // Must not throw — proves no Proxy objects in the output
      expect(() => JSON.parse(JSON.stringify(result))).not.toThrow()
    })
  })
})
