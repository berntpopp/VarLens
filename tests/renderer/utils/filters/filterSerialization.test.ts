import { describe, it, expect } from 'vitest'
import { reactive } from 'vue'
import { buildIpcParams } from '../../../../src/renderer/src/utils/filters/filterSerialization'
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
    minCarriers: null,
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
    considerPhasing: false,
    columnFilters: {},
    ...overrides
  }
}

describe('buildIpcParams', () => {
  it('returns empty object for default filters', () => {
    const result = buildIpcParams(makeDefaultFilters())
    expect(result).toEqual({})
  })

  // --- Internal AF serialization ---

  describe('internal AF', () => {
    it('serializes maxInternalAf to max_internal_af', () => {
      const result = buildIpcParams(makeDefaultFilters({ maxInternalAf: 0.05 }))
      expect(result.max_internal_af).toBe(0.05)
    })

    it('excludes maxInternalAf when null', () => {
      const result = buildIpcParams(makeDefaultFilters({ maxInternalAf: null }))
      expect(result.max_internal_af).toBeUndefined()
    })

    it('excludes maxInternalAf when zero', () => {
      const result = buildIpcParams(makeDefaultFilters({ maxInternalAf: 0 }))
      expect(result.max_internal_af).toBeUndefined()
    })

    it('excludes maxInternalAf when NaN', () => {
      const result = buildIpcParams(makeDefaultFilters({ maxInternalAf: NaN }))
      expect(result.max_internal_af).toBeUndefined()
    })

    it('preserves small decimal values', () => {
      const result = buildIpcParams(makeDefaultFilters({ maxInternalAf: 0.001 }))
      expect(result.max_internal_af).toBe(0.001)
    })
  })

  // --- Inheritance mode serialization ---

  describe('inheritance modes', () => {
    it('serializes inheritanceModes to inheritance_modes', () => {
      const result = buildIpcParams(
        makeDefaultFilters({ inheritanceModes: ['homozygous', 'de_novo'] })
      )
      expect(result.inheritance_modes).toEqual(['homozygous', 'de_novo'])
    })

    it('clones array to avoid Vue proxy issues', () => {
      const modes = ['homozygous']
      const result = buildIpcParams(makeDefaultFilters({ inheritanceModes: modes }))
      expect(result.inheritance_modes).not.toBe(modes) // different reference
      expect(result.inheritance_modes).toEqual(modes) // same content
    })

    it('excludes inheritance_modes when empty', () => {
      const result = buildIpcParams(makeDefaultFilters({ inheritanceModes: [] }))
      expect(result.inheritance_modes).toBeUndefined()
    })

    it('serializes analysisGroupId to analysis_group_id', () => {
      const result = buildIpcParams(makeDefaultFilters({ analysisGroupId: 42 }))
      expect(result.analysis_group_id).toBe(42)
    })

    it('excludes analysis_group_id when null', () => {
      const result = buildIpcParams(makeDefaultFilters({ analysisGroupId: null }))
      expect(result.analysis_group_id).toBeUndefined()
    })

    it('serializes considerPhasing to consider_phasing when true', () => {
      const result = buildIpcParams(makeDefaultFilters({ considerPhasing: true }))
      expect(result.consider_phasing).toBe(true)
    })

    it('excludes consider_phasing when false', () => {
      const result = buildIpcParams(makeDefaultFilters({ considerPhasing: false }))
      expect(result.consider_phasing).toBeUndefined()
    })
  })

  // --- Combined filters ---

  describe('combined filters', () => {
    it('serializes all inheritance fields together', () => {
      const result = buildIpcParams(
        makeDefaultFilters({
          inheritanceModes: ['de_novo', 'autosomal_recessive'],
          analysisGroupId: 5,
          considerPhasing: true
        })
      )
      expect(result.inheritance_modes).toEqual(['de_novo', 'autosomal_recessive'])
      expect(result.analysis_group_id).toBe(5)
      expect(result.consider_phasing).toBe(true)
    })

    it('combines internal AF with inheritance modes', () => {
      const result = buildIpcParams(
        makeDefaultFilters({
          maxInternalAf: 0.01,
          inheritanceModes: ['homozygous'],
          maxGnomadAf: 0.001
        })
      )
      expect(result.max_internal_af).toBe(0.01)
      expect(result.inheritance_modes).toEqual(['homozygous'])
      expect(result.gnomad_af_max).toBe(0.001)
    })
  })

  // --- column filters / Vue reactive proxy regression (Sprint A A2) ---

  describe('column filters', () => {
    it('clones plain column filters into IPC-safe params', () => {
      const columnFilters: ColumnFiltersParam = {
        cadd: { operator: '>', value: 20, includeEmpty: true }
      }
      const result = buildIpcParams(makeDefaultFilters({ columnFilters }))
      expect(result.column_filters).toEqual(columnFilters)
      expect(result.column_filters).not.toBe(columnFilters)
    })

    it('serializes a Vue reactive() columnFilters proxy without DataCloneError', () => {
      // Regression: getIpcParams()/handleRun() spread filters.value shallowly,
      // so columnFilters reaches the shared serializer as a reactive proxy.
      // structuredClone would throw DataCloneError on it; the serializer must
      // tolerate the proxy and emit plain, IPC-safe data.
      const columnFilters = reactive<ColumnFiltersParam>({
        'cnv.copy_number': { operator: 'in', value: ['0', '1'], includeEmpty: false }
      })
      const result = buildIpcParams(makeDefaultFilters({ columnFilters }))
      expect(result.column_filters).toEqual({
        'cnv.copy_number': { operator: 'in', value: ['0', '1'], includeEmpty: false }
      })
      // Output must be plain JS (deep-cloned), not the live reactive proxy.
      expect(result.column_filters).not.toBe(columnFilters)
    })
  })

  // #504: v-model.number leaves '' in an emptied number field
  it('drops non-numeric numeric fields instead of sending them', () => {
    const empty = '' as unknown as number
    const params = buildIpcParams(
      makeDefaultFilters({ minCadd: empty, maxGnomadAf: empty, maxInternalAf: empty })
    )
    expect(params).toEqual({})
  })
})
