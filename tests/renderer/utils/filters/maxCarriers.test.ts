/**
 * Carrier cap (#455) in the renderer state utilities. The preset behaviour is
 * asserted for the case view and the cohort view so the two cannot drift.
 */
import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import type { Ref } from 'vue'

import { TYPED_FILTER_FIELDS } from '../../../../src/renderer/src/composables/useFilterEmitScheduler'
import {
  buildActiveFiltersList,
  summarizeInternalFilters
} from '../../../../src/renderer/src/utils/filters/activeFilters'
import {
  clearAllFilters,
  clearFilter
} from '../../../../src/renderer/src/utils/filters/filterClearing'
import {
  buildFilterIpcParams,
  buildVariantFilterFromState
} from '../../../../src/renderer/src/utils/filters/filterSerialization'
import {
  activeMaxCarriers,
  maxCarriersLabel,
  parseMaxCarriers
} from '../../../../src/renderer/src/utils/filters/maxCarriers'
import {
  applyPresetStateToFilters,
  buildPresetFilterJson,
  isPresetDiverged
} from '../../../../src/renderer/src/utils/filters/presetApplication'
import { createFilterState } from '../../../../src/shared/filters/filterDefaults'
import type { FilterState } from '../../../../src/shared/types/filters'

const RARE_NOT_RECURRENT: Partial<FilterState> = { maxGnomadAf: 0.01, maxCarriers: 3 }

describe('carrier cap value', () => {
  // Review Focus 1
  it.each([
    ['3', 3],
    [3, 3],
    ['2.7', 2],
    ['1', 1],
    ['0', null],
    ['-4', null],
    ['0.9', null],
    ['', null],
    ['abc', null],
    [null, null],
    [undefined, null]
  ])('parseMaxCarriers(%j) is %j', (raw, expected) => {
    expect(parseMaxCarriers(raw)).toBe(expected)
  })

  // Review Focus 2
  it.each([
    [3, 3],
    [1, 1],
    [0, null],
    [-1, null],
    [2.5, null],
    [Number.NaN, null],
    ['3', null],
    [null, null]
  ])('activeMaxCarriers(%j) is %j', (value, expected) => {
    expect(activeMaxCarriers(value)).toBe(expected)
  })

  it('reads as a number of cases', () => {
    expect(maxCarriersLabel(1)).toBe('≤ 1 case')
    expect(maxCarriersLabel(3)).toBe('≤ 3 cases')
  })
})

describe('carrier cap serialization', () => {
  it('sends an active cap as carrier_count_max on both query shapes', () => {
    const filters = createFilterState({ maxCarriers: 3 })
    expect(buildFilterIpcParams(filters).carrier_count_max).toBe(3)
    expect(buildVariantFilterFromState(filters, []).carrier_count_max).toBe(3)
  })

  // Review Focus 2: the schema rejects these, so they must never be sent.
  it.each([null, 0, -1, 2.5, Number.NaN, ''])('sends nothing for %j', (value) => {
    const filters = createFilterState({ maxCarriers: value as never })
    expect(buildFilterIpcParams(filters)).not.toHaveProperty('carrier_count_max')
    expect(buildVariantFilterFromState(filters, [])).not.toHaveProperty('carrier_count_max')
  })
})

describe('carrier cap chip, summary and clearing', () => {
  it('shows a chip while the cap is on', () => {
    const chip = buildActiveFiltersList(createFilterState({ maxCarriers: 3 })).find(
      (f) => f.id === 'max-carriers'
    )
    expect(chip).toEqual({ id: 'max-carriers', label: 'Seen in', value: '≤ 3 cases' })
    expect(
      buildActiveFiltersList(createFilterState()).find((f) => f.id === 'max-carriers')
    ).toBeUndefined()
    expect(
      buildActiveFiltersList(createFilterState({ maxCarriers: 0 })).find(
        (f) => f.id === 'max-carriers'
      )
    ).toBeUndefined()
  })

  it('summarizes the internal filters of the drawer panel', () => {
    expect(summarizeInternalFilters({ maxInternalAf: null, maxCarriers: null })).toBe('')
    expect(summarizeInternalFilters({ maxInternalAf: 0.05, maxCarriers: null })).toBe('<= 5.00%')
    expect(summarizeInternalFilters({ maxInternalAf: null, maxCarriers: 3 })).toBe('≤ 3 cases')
    expect(summarizeInternalFilters({ maxInternalAf: 0.05, maxCarriers: 1 })).toBe(
      '<= 5.00%, ≤ 1 case'
    )
  })

  it('clears with its chip and with Clear all', () => {
    expect(clearFilter('max-carriers')).toEqual({ maxCarriers: null })
    expect(clearAllFilters().maxCarriers).toBeNull()
  })

  it('a typed cap waits for a typing pause like the other number fields', () => {
    expect(TYPED_FILTER_FIELDS.has('maxCarriers')).toBe(true)
  })
})

interface View {
  filters: Ref<FilterState>
  apply(presetState: Partial<FilterState>): void
  diverged(presetFilterJson: Partial<FilterState>): boolean
}

function caseView(): View {
  const filters = ref<FilterState>(createFilterState())
  return {
    filters,
    apply: (presetState) => applyPresetStateToFilters({ filters, presetState }),
    diverged: (presetFilterJson) => isPresetDiverged({ filters: filters.value, presetFilterJson })
  }
}

function cohortView(): View {
  const filters = ref<FilterState>(createFilterState())
  const impact = ref<string[]>([])
  return {
    filters,
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
  'preset carrier cap, %s view',
  (_name, makeView) => {
    it('applies the cap and serializes it', () => {
      const view = makeView()
      view.apply(RARE_NOT_RECURRENT)

      expect(view.filters.value).toMatchObject({ maxGnomadAf: 0.01, maxCarriers: 3 })
      expect(buildFilterIpcParams(view.filters.value)).toMatchObject({
        gnomad_af_max: 0.01,
        carrier_count_max: 3
      })
    })

    it('turns the cap off when the preset is toggled off', () => {
      const view = makeView()
      view.apply(RARE_NOT_RECURRENT)
      view.apply({})

      expect(view.filters.value.maxCarriers).toBeNull()
      expect(buildFilterIpcParams(view.filters.value)).not.toHaveProperty('carrier_count_max')
    })

    it('reports divergence once the user changes the cap', () => {
      const view = makeView()
      view.apply(RARE_NOT_RECURRENT)
      expect(view.diverged(RARE_NOT_RECURRENT)).toBe(false)

      view.filters.value.maxCarriers = 5
      expect(view.diverged(RARE_NOT_RECURRENT)).toBe(true)
    })

    it('does not treat the cap as divergence for a preset that never set it', () => {
      const view = makeView()
      view.apply({ maxGnomadAf: 0.01 })

      view.filters.value.maxCarriers = 5
      expect(view.diverged({ maxGnomadAf: 0.01 })).toBe(false)
    })

    it('a saved preset round-trips the cap', () => {
      const saved = buildPresetFilterJson(createFilterState({ maxGnomadAf: 0.01, maxCarriers: 3 }))
      expect(saved).toEqual({ maxGnomadAf: 0.01, maxCarriers: 3 })

      const view = makeView()
      view.apply(saved)
      expect(view.filters.value).toMatchObject({ maxGnomadAf: 0.01, maxCarriers: 3 })
    })
  }
)
