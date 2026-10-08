/**
 * Preset → filter state → serialized IPC params, for the internal cohort
 * frequency threshold (`maxInternalAf` / `max_internal_af`) — issue #123.
 *
 * Both views apply presets through the same `applyPresetStateToFilters`
 * helper: the case view writes straight into its FilterState, the cohort view
 * additionally redirects consequences and owns `minCarriers`. Every behaviour
 * is asserted for both shapes so the two surfaces cannot drift.
 */

import { describe, it, expect } from 'vitest'
import { ref } from 'vue'
import type { Ref } from 'vue'
import type { FilterState } from '../../../../src/shared/types/filters'
import {
  applyPresetStateToFilters,
  buildPresetFilterJson,
  isPresetDiverged
} from '../../../../src/renderer/src/utils/filters/presetApplication'
import { createFilterState } from '../../../../src/shared/filters/filterDefaults'
import {
  buildFilterIpcParams,
  buildVariantFilterFromState
} from '../../../../src/renderer/src/utils/filters/filterSerialization'

const RARE_WITH_INTERNAL: Partial<FilterState> = { maxGnomadAf: 0.01, maxInternalAf: 0.01 }

interface View {
  name: 'case' | 'cohort'
  filters: Ref<FilterState>
  impact: Ref<string[]>
  apply(presetState: Partial<FilterState>): void
  diverged(presetFilterJson: Partial<FilterState>): boolean
}

function caseView(): View {
  const filters = ref<FilterState>(createFilterState())
  const impact = ref<string[]>([])
  return {
    name: 'case',
    filters,
    impact,
    apply: (presetState) => applyPresetStateToFilters({ filters, presetState }),
    diverged: (presetFilterJson) => isPresetDiverged({ filters: filters.value, presetFilterJson })
  }
}

function cohortView(): View {
  const filters = ref<FilterState>(createFilterState())
  const impact = ref<string[]>([])
  return {
    name: 'cohort',
    filters,
    impact,
    apply: (presetState) =>
      applyPresetStateToFilters({
        filters,
        presetState,
        consequencesTarget: impact,
        includeCohortFields: true
      }),
    diverged: (presetFilterJson) =>
      isPresetDiverged({
        filters: filters.value,
        presetFilterJson,
        consequencesValue: impact.value
      })
  }
}

describe.each([['case', caseView] as const, ['cohort', cohortView] as const])(
  'preset internal-frequency threshold — %s view',
  (_name, makeView) => {
    it('applies maxInternalAf alongside maxGnomadAf', () => {
      const view = makeView()

      view.apply(RARE_WITH_INTERNAL)

      expect(view.filters.value.maxGnomadAf).toBe(0.01)
      expect(view.filters.value.maxInternalAf).toBe(0.01)
    })

    it('serializes the applied threshold as max_internal_af', () => {
      const view = makeView()

      view.apply(RARE_WITH_INTERNAL)

      expect(buildFilterIpcParams(view.filters.value)).toMatchObject({
        gnomad_af_max: 0.01,
        max_internal_af: 0.01
      })
      expect(buildVariantFilterFromState(view.filters.value, view.impact.value)).toMatchObject({
        gnomad_af_max: 0.01,
        max_internal_af: 0.01
      })
    })

    it('clears maxInternalAf when the preset is toggled off', () => {
      const view = makeView()
      view.apply(RARE_WITH_INTERNAL)

      view.apply({})

      expect(view.filters.value.maxInternalAf).toBeNull()
      expect(buildFilterIpcParams(view.filters.value).max_internal_af).toBeUndefined()
    })

    it('leaves maxInternalAf unset for a preset that only sets gnomAD AF', () => {
      const view = makeView()

      view.apply({ maxGnomadAf: 0.01 })

      expect(view.filters.value.maxGnomadAf).toBe(0.01)
      expect(view.filters.value.maxInternalAf).toBeNull()
      expect(buildFilterIpcParams(view.filters.value).max_internal_af).toBeUndefined()
    })

    it('reports divergence once the user changes the internal threshold', () => {
      const view = makeView()
      view.apply(RARE_WITH_INTERNAL)
      expect(view.diverged(RARE_WITH_INTERNAL)).toBe(false)

      view.filters.value.maxInternalAf = 0.05
      expect(view.diverged(RARE_WITH_INTERNAL)).toBe(true)
    })

    it('does not treat maxInternalAf as divergence for presets that never set it', () => {
      const view = makeView()
      view.apply({ maxGnomadAf: 0.01 })

      view.filters.value.maxInternalAf = 0.05
      expect(view.diverged({ maxGnomadAf: 0.01 })).toBe(false)
    })
  }
)

// #504: a preset saves exactly what applying it restores
describe('buildPresetFilterJson', () => {
  it('keeps only the set preset fields and saves the impact chips as consequences', () => {
    const filters = createFilterState({
      minCadd: 20,
      clinvars: ['Pathogenic'],
      activePanelIds: [3],
      inheritanceModes: ['de_novo'],
      tagIds: [7],
      searchQuery: 'BRCA1'
    })

    expect(buildPresetFilterJson(filters, ['HIGH'])).toEqual({
      minCadd: 20,
      clinvars: ['Pathogenic'],
      consequences: ['HIGH']
    })
  })

  it('round-trips through applyPresetStateToFilters in the case and the cohort view', () => {
    const saved = buildPresetFilterJson(
      createFilterState({ maxGnomadAf: 0.001, starredOnly: true, minCarriers: 2 }),
      ['HIGH', 'MODERATE']
    )

    const caseFilters = ref(createFilterState())
    applyPresetStateToFilters({ filters: caseFilters, presetState: saved })
    expect(caseFilters.value).toMatchObject({
      maxGnomadAf: 0.001,
      starredOnly: true,
      consequences: ['HIGH', 'MODERATE']
    })

    const cohortFilters = ref(createFilterState())
    const impact = ref<string[]>([])
    applyPresetStateToFilters({
      filters: cohortFilters,
      presetState: saved,
      consequencesTarget: impact,
      includeCohortFields: true
    })
    expect(cohortFilters.value).toMatchObject({ maxGnomadAf: 0.001, minCarriers: 2 })
    expect(impact.value).toEqual(['HIGH', 'MODERATE'])
  })
})
