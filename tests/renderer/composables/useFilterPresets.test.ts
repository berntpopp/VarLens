import { describe, it, expect } from 'vitest'
import { afPresets, caddPresets } from '../../../src/renderer/src/composables/useFilterPresets'

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
})
