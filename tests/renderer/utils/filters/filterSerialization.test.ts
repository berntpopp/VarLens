import { describe, it, expect } from 'vitest'
import { buildIpcParams } from '../../../../src/renderer/src/utils/filters/filterSerialization'
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
    minCarriers: null,
    starredOnly: false,
    hasCommentOnly: false,
    acmgClassifications: [],
    activePanelIds: [],
    panelPaddingBp: 5000,
    maxInternalAf: null,
    inheritanceModes: [],
    analysisGroupId: null,
    considerPhasing: false,
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
})
