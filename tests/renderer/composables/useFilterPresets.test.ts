import { describe, it, expect } from 'vitest'
import { nextTick, ref } from 'vue'
import {
  afPresets,
  caddPresets,
  useFilterPresets
} from '../../../src/renderer/src/composables/useFilterPresets'
import { createFilterState } from '../../../src/shared/filters/filterDefaults'

describe('useFilterPresets', () => {
  describe('afPresets', () => {
    it('labels include <= operator to show filter direction', () => {
      for (const preset of afPresets) {
        expect(preset.label).toMatch(/^<= /)
      }
    })

    it('has correct label-value pairs', () => {
      expect(afPresets).toEqual([
        { label: '<= 1%', value: 0.01 },
        { label: '<= 0.1%', value: 0.001 },
        { label: '<= 0.01%', value: 0.0001 }
      ])
    })
  })

  describe('caddPresets', () => {
    it('labels include >= operator to show filter direction', () => {
      for (const preset of caddPresets) {
        expect(preset.label).toMatch(/^>= /)
      }
    })

    it('has correct label-value pairs', () => {
      expect(caddPresets).toEqual([
        { label: '>= 10', value: 10 },
        { label: '>= 15', value: 15 },
        { label: '>= 20', value: 20 },
        { label: '>= 25', value: 25 }
      ])
    })
  })

  // #504: case drawer number fields
  describe('number field next to an active preset', () => {
    it('keeps a typed CADD value that is not a preset', async () => {
      const filters = ref(createFilterState())
      const { selectedCaddPreset } = useFilterPresets(filters, () => {})
      selectedCaddPreset.value = 20
      await nextTick()

      filters.value.minCadd = 22
      await nextTick()
      await nextTick()

      expect(selectedCaddPreset.value).toBeNull()
      expect(filters.value.minCadd).toBe(22)
    })

    it('keeps a typed AF value that is not a preset', async () => {
      const filters = ref(createFilterState())
      const { selectedAfPreset } = useFilterPresets(filters, () => {})
      selectedAfPreset.value = 0.01
      await nextTick()

      filters.value.maxGnomadAf = 0.02
      await nextTick()
      await nextTick()

      expect(selectedAfPreset.value).toBeNull()
      expect(filters.value.maxGnomadAf).toBe(0.02)
    })

    it('still clears the field when the preset chip is deselected', async () => {
      const filters = ref(createFilterState())
      const { selectedCaddPreset } = useFilterPresets(filters, () => {})
      selectedCaddPreset.value = 20
      await nextTick()
      selectedCaddPreset.value = null
      await nextTick()

      expect(filters.value.minCadd).toBeNull()
    })

    it('turns an emptied CADD field into null', async () => {
      const filters = ref(createFilterState())
      useFilterPresets(filters, () => {})
      filters.value.minCadd = '' as unknown as number
      await nextTick()

      expect(filters.value.minCadd).toBeNull()
    })
  })
})
