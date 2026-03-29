/**
 * Unit tests for useFilters composable
 *
 * Tests bidirectional preset/custom sync, filter state management,
 * hasActiveFilters computed, clear methods, and IPC parameter generation.
 *
 * Uses createFilters() factory directly — each test gets its own instance.
 */

import { describe, it, expect, afterEach } from 'vitest'
import { nextTick } from 'vue'
import { withSetup } from '../../utils/test-helpers'
import { createFilters } from '@renderer/composables/useFilters'

describe('useFilters', () => {
  let app: { unmount: () => void }

  afterEach(() => {
    if (app) app.unmount()
  })

  describe('Initial state', () => {
    it('initializes with empty filter state', () => {
      const [result, appInstance] = withSetup(() => createFilters())
      app = appInstance

      expect(result.filters.value.geneSymbol).toBe('')
      expect(result.filters.value.consequences).toEqual([])
      expect(result.filters.value.funcs).toEqual([])
      expect(result.filters.value.clinvars).toEqual([])
      expect(result.filters.value.maxGnomadAf).toBeNull()
      expect(result.filters.value.minCadd).toBeNull()
      expect(result.filters.value.minCarriers).toBeNull()
    })

    it('initializes with empty search term', () => {
      const [result, appInstance] = withSetup(() => createFilters())
      app = appInstance

      expect(result.searchTerm.value).toBe('')
    })

    it('initializes with no presets selected', () => {
      const [result, appInstance] = withSetup(() => createFilters())
      app = appInstance

      expect(result.selectedImpactPresets.value).toEqual([])
      expect(result.selectedAfPreset.value).toBeNull()
      expect(result.selectedCaddPreset.value).toBeNull()
    })

    it('initializes with no custom inputs', () => {
      const [result, appInstance] = withSetup(() => createFilters())
      app = appInstance

      expect(result.customGnomadAf.value).toBeNull()
      expect(result.customCadd.value).toBeNull()
    })

    it('hasActiveFilters returns false for initial state', () => {
      const [result, appInstance] = withSetup(() => createFilters())
      app = appInstance

      expect(result.hasActiveFilters.value).toBe(false)
    })
  })

  describe('hasActiveFilters computed', () => {
    it('returns true when geneSymbol is set', () => {
      const [result, appInstance] = withSetup(() => createFilters())
      app = appInstance

      result.filters.value.geneSymbol = 'BRCA1'
      expect(result.hasActiveFilters.value).toBe(true)
    })

    it('returns true when searchTerm is set', () => {
      const [result, appInstance] = withSetup(() => createFilters())
      app = appInstance

      result.searchTerm.value = 'chr1:12345'
      expect(result.hasActiveFilters.value).toBe(true)
    })

    it('returns true when consequences array is not empty', () => {
      const [result, appInstance] = withSetup(() => createFilters())
      app = appInstance

      result.filters.value.consequences = ['missense_variant']
      expect(result.hasActiveFilters.value).toBe(true)
    })

    it('returns true when funcs array is not empty', () => {
      const [result, appInstance] = withSetup(() => createFilters())
      app = appInstance

      result.filters.value.funcs = ['protein_coding']
      expect(result.hasActiveFilters.value).toBe(true)
    })

    it('returns true when clinvars array is not empty', () => {
      const [result, appInstance] = withSetup(() => createFilters())
      app = appInstance

      result.filters.value.clinvars = ['Pathogenic']
      expect(result.hasActiveFilters.value).toBe(true)
    })

    it('returns true when maxGnomadAf is set (> 0)', () => {
      const [result, appInstance] = withSetup(() => createFilters())
      app = appInstance

      result.filters.value.maxGnomadAf = 0.01
      expect(result.hasActiveFilters.value).toBe(true)
    })

    it('returns false when maxGnomadAf is 0', () => {
      const [result, appInstance] = withSetup(() => createFilters())
      app = appInstance

      result.filters.value.maxGnomadAf = 0
      expect(result.hasActiveFilters.value).toBe(false)
    })

    it('returns true when minCadd is set (>= 0)', () => {
      const [result, appInstance] = withSetup(() => createFilters())
      app = appInstance

      result.filters.value.minCadd = 20
      expect(result.hasActiveFilters.value).toBe(true)
    })

    it('returns true when minCadd is 0', () => {
      const [result, appInstance] = withSetup(() => createFilters())
      app = appInstance

      result.filters.value.minCadd = 0
      expect(result.hasActiveFilters.value).toBe(true)
    })

    it('returns true when minCarriers is set (> 0)', () => {
      const [result, appInstance] = withSetup(() => createFilters())
      app = appInstance

      result.filters.value.minCarriers = 2
      expect(result.hasActiveFilters.value).toBe(true)
    })

    it('returns true when impact presets are selected', () => {
      const [result, appInstance] = withSetup(() => createFilters())
      app = appInstance

      result.selectedImpactPresets.value = ['high']
      expect(result.hasActiveFilters.value).toBe(true)
    })

    it('returns true when AF preset is selected', () => {
      const [result, appInstance] = withSetup(() => createFilters())
      app = appInstance

      result.selectedAfPreset.value = 0.01
      expect(result.hasActiveFilters.value).toBe(true)
    })

    it('returns true when CADD preset is selected', () => {
      const [result, appInstance] = withSetup(() => createFilters())
      app = appInstance

      result.selectedCaddPreset.value = 15
      expect(result.hasActiveFilters.value).toBe(true)
    })

    it('returns false after clearAllFilters()', () => {
      const [result, appInstance] = withSetup(() => createFilters())
      app = appInstance

      result.filters.value.geneSymbol = 'BRCA1'
      result.searchTerm.value = 'test'
      expect(result.hasActiveFilters.value).toBe(true)

      result.clearAllFilters()
      expect(result.hasActiveFilters.value).toBe(false)
    })
  })

  describe('clearAllFilters', () => {
    it('resets all filter state to initial values', () => {
      const [result, appInstance] = withSetup(() => createFilters())
      app = appInstance

      // Set various filters
      result.filters.value.geneSymbol = 'BRCA1'
      result.filters.value.consequences = ['missense_variant']
      result.filters.value.maxGnomadAf = 0.01
      result.filters.value.minCadd = 20
      result.searchTerm.value = 'test'

      result.clearAllFilters()

      expect(result.filters.value.geneSymbol).toBe('')
      expect(result.filters.value.consequences).toEqual([])
      expect(result.filters.value.maxGnomadAf).toBeNull()
      expect(result.filters.value.minCadd).toBeNull()
      expect(result.searchTerm.value).toBe('')
    })

    it('clears all presets', () => {
      const [result, appInstance] = withSetup(() => createFilters())
      app = appInstance

      result.selectedImpactPresets.value = ['high']
      result.selectedAfPreset.value = 0.01
      result.selectedCaddPreset.value = 15

      result.clearAllFilters()

      expect(result.selectedImpactPresets.value).toEqual([])
      expect(result.selectedAfPreset.value).toBeNull()
      expect(result.selectedCaddPreset.value).toBeNull()
    })

    it('clears all custom inputs', () => {
      const [result, appInstance] = withSetup(() => createFilters())
      app = appInstance

      result.customGnomadAf.value = 5
      result.customCadd.value = 20
      result.clearAllFilters()

      expect(result.customGnomadAf.value).toBeNull()
      expect(result.customCadd.value).toBeNull()
    })
  })

  describe('clearFilter', () => {
    it('clears gene filter', () => {
      const [result, appInstance] = withSetup(() => createFilters())
      app = appInstance

      result.filters.value.geneSymbol = 'BRCA1'
      result.clearFilter('gene')
      expect(result.filters.value.geneSymbol).toBe('')
    })

    it('clears impact filter (consequences array)', () => {
      const [result, appInstance] = withSetup(() => createFilters())
      app = appInstance

      result.filters.value.consequences = ['missense_variant']
      result.clearFilter('impact')
      expect(result.filters.value.consequences).toEqual([])
    })

    it('clears frequency filter and associated preset/custom', () => {
      const [result, appInstance] = withSetup(() => createFilters())
      app = appInstance

      result.filters.value.maxGnomadAf = 0.01
      result.selectedAfPreset.value = 0.01
      result.customGnomadAf.value = 1

      result.clearFilter('frequency')

      expect(result.filters.value.maxGnomadAf).toBeNull()
      expect(result.selectedAfPreset.value).toBeNull()
      expect(result.customGnomadAf.value).toBeNull()
    })

    it('clears CADD filter and associated preset/custom', () => {
      const [result, appInstance] = withSetup(() => createFilters())
      app = appInstance

      result.filters.value.minCadd = 20
      result.selectedCaddPreset.value = 15
      result.customCadd.value = 25

      result.clearFilter('cadd')

      expect(result.filters.value.minCadd).toBeNull()
      expect(result.selectedCaddPreset.value).toBeNull()
      expect(result.customCadd.value).toBeNull()
    })

    it('clears impact presets', () => {
      const [result, appInstance] = withSetup(() => createFilters())
      app = appInstance

      result.selectedImpactPresets.value = ['high', 'moderate']

      result.clearFilter('impact')

      expect(result.selectedImpactPresets.value).toEqual([])
    })

    it('clears search filter', () => {
      const [result, appInstance] = withSetup(() => createFilters())
      app = appInstance

      result.searchTerm.value = 'chr1:12345'

      result.clearFilter('search')

      expect(result.searchTerm.value).toBe('')
    })
  })

  describe('Bidirectional preset/custom sync', () => {
    it('setting selectedAfPreset updates maxGnomadAf and clears customGnomadAf', async () => {
      const [result, appInstance] = withSetup(() => createFilters())
      app = appInstance

      result.customGnomadAf.value = 5
      await nextTick()

      result.selectedAfPreset.value = 0.01
      await nextTick()

      expect(result.filters.value.maxGnomadAf).toBe(0.01)
      expect(result.customGnomadAf.value).toBeNull()
    })

    it('setting customGnomadAf (> 0) updates maxGnomadAf and clears selectedAfPreset', async () => {
      const [result, appInstance] = withSetup(() => createFilters())
      app = appInstance

      // First clear any preset
      result.selectedAfPreset.value = null
      await nextTick()

      // Then set custom value
      result.customGnomadAf.value = 5 // 5% -> 0.05 decimal
      await nextTick()

      expect(result.filters.value.maxGnomadAf).toBe(0.05)
      expect(result.selectedAfPreset.value).toBeNull()
    })

    it('setting selectedCaddPreset updates minCadd and clears customCadd', async () => {
      const [result, appInstance] = withSetup(() => createFilters())
      app = appInstance

      result.customCadd.value = 25
      await nextTick()

      result.selectedCaddPreset.value = 15
      await nextTick()

      expect(result.filters.value.minCadd).toBe(15)
      expect(result.customCadd.value).toBeNull()
    })

    it('setting customCadd (>= 0) updates minCadd and clears selectedCaddPreset', async () => {
      const [result, appInstance] = withSetup(() => createFilters())
      app = appInstance

      // First clear any preset
      result.selectedCaddPreset.value = null
      await nextTick()

      // Then set custom value
      result.customCadd.value = 20
      await nextTick()

      expect(result.filters.value.minCadd).toBe(20)
      expect(result.selectedCaddPreset.value).toBeNull()
    })

    it('validates customGnomadAf range (0-100)', async () => {
      const [result, appInstance] = withSetup(() => createFilters())
      app = appInstance

      result.customGnomadAf.value = 150 // Invalid - exceeds max
      await nextTick()

      expect(result.customGnomadAf.value).toBeNull()
      expect(result.filters.value.maxGnomadAf).toBeNull()
    })

    it('validates customCadd range (0-60)', async () => {
      const [result, appInstance] = withSetup(() => createFilters())
      app = appInstance

      result.customCadd.value = 70 // Invalid - exceeds max
      await nextTick()

      expect(result.customCadd.value).toBeNull()
      expect(result.filters.value.minCadd).toBeNull()
    })

  })

  describe('getIpcParams', () => {
    it('returns object with snake_case keys', () => {
      const [result, appInstance] = withSetup(() => createFilters())
      app = appInstance

      result.filters.value.maxGnomadAf = 0.01
      result.filters.value.minCadd = 20

      const params = result.getIpcParams()

      expect(params).toHaveProperty('gnomad_af_max')
      expect(params).toHaveProperty('cadd_min')
    })

    it('includes searchTerm as search_term', () => {
      const [result, appInstance] = withSetup(() => createFilters())
      app = appInstance

      result.searchTerm.value = 'chr1:12345'

      const params = result.getIpcParams()

      expect(params.search_term).toBe('chr1:12345')
    })

    it('converts filter state correctly', () => {
      const [result, appInstance] = withSetup(() => createFilters())
      app = appInstance

      result.filters.value.geneSymbol = 'BRCA1'
      result.filters.value.consequences = ['missense_variant']
      result.filters.value.maxGnomadAf = 0.01

      const params = result.getIpcParams()

      expect(params.gene_symbol).toBe('BRCA1')
      expect(params.consequences).toEqual(['missense_variant'])
      expect(params.gnomad_af_max).toBe(0.01)
    })
  })

  describe('activeFiltersList computed', () => {
    it('returns empty array for no active filters', () => {
      const [result, appInstance] = withSetup(() => createFilters())
      app = appInstance

      expect(result.activeFiltersList.value).toEqual([])
    })

    it('returns active filters for display', () => {
      const [result, appInstance] = withSetup(() => createFilters())
      app = appInstance

      result.filters.value.geneSymbol = 'BRCA1'
      result.filters.value.maxGnomadAf = 0.01

      const list = result.activeFiltersList.value

      expect(list.length).toBeGreaterThan(0)
      expect(Array.isArray(list)).toBe(true)
    })
  })

  describe('reset', () => {
    it('is an alias for clearAllFilters', () => {
      const [result, appInstance] = withSetup(() => createFilters())
      app = appInstance

      result.filters.value.geneSymbol = 'BRCA1'
      result.searchTerm.value = 'test'

      result.reset()

      expect(result.filters.value.geneSymbol).toBe('')
      expect(result.searchTerm.value).toBe('')
      expect(result.hasActiveFilters.value).toBe(false)
    })
  })
})
