/**
 * Unit tests for useFilterCore composable
 *
 * Tests the shared filter primitive layer used by both the case view
 * (useFilterState) and the cohort view (createFilters/useFilters).
 */

import { describe, it, expect, afterEach } from 'vitest'
import { withSetup } from '../../utils/test-helpers'
import { useFilterCore } from '@renderer/composables/useFilterCore'

describe('useFilterCore', () => {
  let app: { unmount: () => void }

  afterEach(() => {
    if (app) app.unmount()
  })

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------

  describe('Initial state', () => {
    it('initializes all array fields to empty arrays', () => {
      const [core, appInstance] = withSetup(() => useFilterCore())
      app = appInstance

      expect(core.consequences.value).toEqual([])
      expect(core.funcs.value).toEqual([])
      expect(core.clinvars.value).toEqual([])
      expect(core.acmgClassifications.value).toEqual([])
    })

    it('initializes all numeric fields to null', () => {
      const [core, appInstance] = withSetup(() => useFilterCore())
      app = appInstance

      expect(core.gnomadAfMax.value).toBeNull()
      expect(core.caddMin.value).toBeNull()
      expect(core.maxInternalAf.value).toBeNull()
    })

    it('activeFilterCount is 0 for initial state', () => {
      const [core, appInstance] = withSetup(() => useFilterCore())
      app = appInstance

      expect(core.activeFilterCount.value).toBe(0)
    })

    it('activeFiltersList is empty for initial state', () => {
      const [core, appInstance] = withSetup(() => useFilterCore())
      app = appInstance

      expect(core.activeFiltersList.value).toEqual([])
    })
  })

  // -------------------------------------------------------------------------
  // activeFilterCount tracking
  // -------------------------------------------------------------------------

  describe('activeFilterCount', () => {
    it('counts one active filter when consequences are set', () => {
      const [core, appInstance] = withSetup(() => useFilterCore())
      app = appInstance

      core.consequences.value = ['HIGH']
      expect(core.activeFilterCount.value).toBe(1)
    })

    it('counts multiple active filters independently', () => {
      const [core, appInstance] = withSetup(() => useFilterCore())
      app = appInstance

      core.consequences.value = ['HIGH', 'MODERATE']
      core.funcs.value = ['missense_variant']
      core.clinvars.value = ['Pathogenic']
      core.gnomadAfMax.value = 0.01
      core.caddMin.value = 20
      core.maxInternalAf.value = 0.05
      core.acmgClassifications.value = ['LP']

      // All 7 shared filters active
      expect(core.activeFilterCount.value).toBe(7)
    })

    it('does not count gnomadAfMax = 0 as active', () => {
      const [core, appInstance] = withSetup(() => useFilterCore())
      app = appInstance

      core.gnomadAfMax.value = 0
      expect(core.activeFilterCount.value).toBe(0)
    })

    it('counts gnomadAfMax > 0 as active', () => {
      const [core, appInstance] = withSetup(() => useFilterCore())
      app = appInstance

      core.gnomadAfMax.value = 0.001
      expect(core.activeFilterCount.value).toBe(1)
    })

    it('counts caddMin = 0 as active (valid threshold)', () => {
      const [core, appInstance] = withSetup(() => useFilterCore())
      app = appInstance

      core.caddMin.value = 0
      expect(core.activeFilterCount.value).toBe(1)
    })

    it('does not count NaN numeric values', () => {
      const [core, appInstance] = withSetup(() => useFilterCore())
      app = appInstance

      core.gnomadAfMax.value = NaN
      core.caddMin.value = NaN
      core.maxInternalAf.value = NaN
      expect(core.activeFilterCount.value).toBe(0)
    })
  })

  // -------------------------------------------------------------------------
  // activeFiltersList generation
  // -------------------------------------------------------------------------

  describe('activeFiltersList', () => {
    it('generates a chip for consequences with correct id and label', () => {
      const [core, appInstance] = withSetup(() => useFilterCore())
      app = appInstance

      core.consequences.value = ['HIGH', 'MODERATE']
      const list = core.activeFiltersList.value

      expect(list).toHaveLength(1)
      expect(list[0].id).toBe('consequences')
      expect(list[0].label).toBe('Impact')
      expect(list[0].value).toContain('selected')
    })

    it('generates a chip for funcs with correct id and label', () => {
      const [core, appInstance] = withSetup(() => useFilterCore())
      app = appInstance

      core.funcs.value = ['missense_variant']
      const list = core.activeFiltersList.value

      expect(list).toHaveLength(1)
      expect(list[0].id).toBe('funcs')
      expect(list[0].label).toBe('Function')
    })

    it('generates a chip for clinvars with correct id and label', () => {
      const [core, appInstance] = withSetup(() => useFilterCore())
      app = appInstance

      core.clinvars.value = ['Pathogenic', 'Likely_pathogenic']
      const list = core.activeFiltersList.value

      expect(list).toHaveLength(1)
      expect(list[0].id).toBe('clinvars')
      expect(list[0].label).toBe('ClinVar')
    })

    it('generates a chip for gnomadAfMax with correct id and label', () => {
      const [core, appInstance] = withSetup(() => useFilterCore())
      app = appInstance

      core.gnomadAfMax.value = 0.01
      const list = core.activeFiltersList.value

      expect(list).toHaveLength(1)
      expect(list[0].id).toBe('gnomad_af')
      expect(list[0].label).toBe('gnomAD AF')
      expect(list[0].value).toContain('1.00%')
    })

    it('generates a chip for caddMin with correct id and label', () => {
      const [core, appInstance] = withSetup(() => useFilterCore())
      app = appInstance

      core.caddMin.value = 25
      const list = core.activeFiltersList.value

      expect(list).toHaveLength(1)
      expect(list[0].id).toBe('cadd')
      expect(list[0].label).toBe('CADD')
      expect(list[0].value).toContain('25')
    })

    it('generates a chip for maxInternalAf with correct id and label', () => {
      const [core, appInstance] = withSetup(() => useFilterCore())
      app = appInstance

      core.maxInternalAf.value = 0.05
      const list = core.activeFiltersList.value

      expect(list).toHaveLength(1)
      expect(list[0].id).toBe('internal_af')
      expect(list[0].label).toBe('Internal AF')
      expect(list[0].value).toContain('5.00%')
    })

    it('generates a chip for acmgClassifications with correct id and label', () => {
      const [core, appInstance] = withSetup(() => useFilterCore())
      app = appInstance

      core.acmgClassifications.value = ['LP', 'P']
      const list = core.activeFiltersList.value

      expect(list).toHaveLength(1)
      expect(list[0].id).toBe('acmg')
      expect(list[0].label).toBe('ACMG')
      expect(list[0].value).toBe('LP, P')
    })

    it('returns chips in a deterministic order', () => {
      const [core, appInstance] = withSetup(() => useFilterCore())
      app = appInstance

      core.consequences.value = ['HIGH']
      core.funcs.value = ['missense_variant']
      core.clinvars.value = ['Pathogenic']
      core.gnomadAfMax.value = 0.01
      core.caddMin.value = 20
      core.maxInternalAf.value = 0.05
      core.acmgClassifications.value = ['LP']

      const ids = core.activeFiltersList.value.map((f) => f.id)
      expect(ids).toEqual([
        'consequences',
        'funcs',
        'clinvars',
        'gnomad_af',
        'cadd',
        'internal_af',
        'acmg'
      ])
    })
  })

  // -------------------------------------------------------------------------
  // reset
  // -------------------------------------------------------------------------

  describe('reset', () => {
    it('clears all shared state back to defaults', () => {
      const [core, appInstance] = withSetup(() => useFilterCore())
      app = appInstance

      // Set everything
      core.consequences.value = ['HIGH']
      core.funcs.value = ['missense_variant']
      core.clinvars.value = ['Pathogenic']
      core.gnomadAfMax.value = 0.01
      core.caddMin.value = 20
      core.maxInternalAf.value = 0.05
      core.acmgClassifications.value = ['LP']

      core.reset()

      expect(core.consequences.value).toEqual([])
      expect(core.funcs.value).toEqual([])
      expect(core.clinvars.value).toEqual([])
      expect(core.gnomadAfMax.value).toBeNull()
      expect(core.caddMin.value).toBeNull()
      expect(core.maxInternalAf.value).toBeNull()
      expect(core.acmgClassifications.value).toEqual([])
    })

    it('activeFilterCount is 0 after reset', () => {
      const [core, appInstance] = withSetup(() => useFilterCore())
      app = appInstance

      core.consequences.value = ['HIGH']
      core.gnomadAfMax.value = 0.01

      core.reset()

      expect(core.activeFilterCount.value).toBe(0)
    })
  })

  // -------------------------------------------------------------------------
  // clearFilter
  // -------------------------------------------------------------------------

  describe('clearFilter', () => {
    it('clears consequences by id', () => {
      const [core, appInstance] = withSetup(() => useFilterCore())
      app = appInstance

      core.consequences.value = ['HIGH']
      core.clearFilter('consequences')
      expect(core.consequences.value).toEqual([])
    })

    it('clears funcs by id', () => {
      const [core, appInstance] = withSetup(() => useFilterCore())
      app = appInstance

      core.funcs.value = ['missense_variant']
      core.clearFilter('funcs')
      expect(core.funcs.value).toEqual([])
    })

    it('clears clinvars by id', () => {
      const [core, appInstance] = withSetup(() => useFilterCore())
      app = appInstance

      core.clinvars.value = ['Pathogenic']
      core.clearFilter('clinvars')
      expect(core.clinvars.value).toEqual([])
    })

    it('clears gnomad_af by id', () => {
      const [core, appInstance] = withSetup(() => useFilterCore())
      app = appInstance

      core.gnomadAfMax.value = 0.01
      core.clearFilter('gnomad_af')
      expect(core.gnomadAfMax.value).toBeNull()
    })

    it('clears cadd by id', () => {
      const [core, appInstance] = withSetup(() => useFilterCore())
      app = appInstance

      core.caddMin.value = 20
      core.clearFilter('cadd')
      expect(core.caddMin.value).toBeNull()
    })

    it('clears internal_af by id', () => {
      const [core, appInstance] = withSetup(() => useFilterCore())
      app = appInstance

      core.maxInternalAf.value = 0.05
      core.clearFilter('internal_af')
      expect(core.maxInternalAf.value).toBeNull()
    })

    it('clears acmg by id', () => {
      const [core, appInstance] = withSetup(() => useFilterCore())
      app = appInstance

      core.acmgClassifications.value = ['LP', 'P']
      core.clearFilter('acmg')
      expect(core.acmgClassifications.value).toEqual([])
    })

    it('does nothing for unknown filter id (no error)', () => {
      const [core, appInstance] = withSetup(() => useFilterCore())
      app = appInstance

      core.consequences.value = ['HIGH']

      // Should not throw
      expect(() => core.clearFilter('unknown_filter_id')).not.toThrow()

      // Other state unchanged
      expect(core.consequences.value).toEqual(['HIGH'])
    })

    it('only clears the targeted filter, leaving others intact', () => {
      const [core, appInstance] = withSetup(() => useFilterCore())
      app = appInstance

      core.consequences.value = ['HIGH']
      core.funcs.value = ['missense_variant']
      core.gnomadAfMax.value = 0.01

      core.clearFilter('funcs')

      expect(core.consequences.value).toEqual(['HIGH'])
      expect(core.funcs.value).toEqual([])
      expect(core.gnomadAfMax.value).toBe(0.01)
    })
  })
})
