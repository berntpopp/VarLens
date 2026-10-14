/**
 * The selector searches the bundled HPO list in the renderer, so it works
 * offline and never calls the network-backed `hpo:search` channel (#509).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'

import HpoTermSelector from '../../../src/renderer/src/components/HpoTermSelector.vue'
import { createMockApi } from '../../utils/mock-api'
import type { CaseHpoTerm } from '../../../src/shared/types/api'

vi.mock('../../../src/renderer/src/services/LogService', () => ({
  logService: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }
}))
vi.mock('../../../src/renderer/src/utils/runtime-features', () => ({
  runtimeFeatureUnavailableReason: () => null
}))

describe('HpoTermSelector', () => {
  it('finds terms in the bundled list without calling hpo:search', async () => {
    const api = createMockApi()
    api.hpo.search = vi.fn().mockRejectedValue(new Error('offline'))
    window.api = api

    const wrapper = mount(HpoTermSelector, {
      props: { modelValue: [] },
      global: { plugins: [createVuetify({ components, directives })] }
    })
    const autocomplete = wrapper.findComponent({ name: 'VAutocomplete' })
    autocomplete.vm.$emit('update:search', 'HP:0001250')

    await vi.waitFor(() =>
      expect(autocomplete.props('items')).toEqual([{ id: 'HP:0001250', name: 'Seizure' }])
    )
    expect(api.hpo.search).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  describe('present / excluded / key states', () => {
    const term = (hpo_id: string, hpo_label: string, flags: Partial<CaseHpoTerm> = {}) =>
      ({
        id: 1,
        case_id: 1,
        hpo_id,
        hpo_label,
        excluded: false,
        key: false,
        created_at: 0,
        ...flags
      }) as CaseHpoTerm
    const terms = [
      term('HP:0001250', 'Seizure', { key: true }),
      term('HP:0001252', 'Hypotonia'),
      term('HP:0000252', 'Microcephaly', { excluded: true })
    ]
    let wrapper: VueWrapper | undefined
    afterEach(() => {
      wrapper?.unmount()
      document.body.innerHTML = ''
    })

    function mountSelector(): VueWrapper {
      window.api = createMockApi()
      wrapper = mount(HpoTermSelector, {
        props: { modelValue: terms },
        attachTo: document.body,
        global: { plugins: [createVuetify({ components, directives })] }
      })
      return wrapper
    }
    const chip = (w: VueWrapper, id: string) => w.get(`[data-testid="hpo-chip-${id}"]`)

    it('groups chips and marks state with text, icon and label, not colour alone', () => {
      const w = mountSelector()
      expect(w.get('[data-testid="hpo-group-present"]').attributes('aria-label')).toBe(
        'Present phenotypes'
      )
      const excluded = w.get('[data-testid="hpo-group-excluded"]')
      expect(excluded.text()).toContain('no Microcephaly')
      expect(excluded.find('.text-decoration-line-through').text()).toBe('Microcephaly')
      expect(chip(w, 'HP:0000252').attributes('aria-label')).toBe('Microcephaly, excluded')
      expect(chip(w, 'HP:0000252').find('.v-chip__prepend').exists()).toBe(true)
      expect(chip(w, 'HP:0001250').attributes('aria-label')).toBe('Seizure, key finding')
      expect(chip(w, 'HP:0001250').classes()).toContain('font-weight-bold')
      expect(chip(w, 'HP:0001252').attributes('aria-label')).toBe('Hypotonia, present')
    })

    it('toggles excluded with x, key with k, and removes with Delete on a focused chip', async () => {
      const w = mountSelector()
      await chip(w, 'HP:0001252').trigger('keydown', { key: 'x' })
      await chip(w, 'HP:0001252').trigger('keydown', { key: 'k' })
      await chip(w, 'HP:0000252').trigger('keydown', { key: 'x' })
      await chip(w, 'HP:0000252').trigger('keydown', { key: 'k' }) // excluded: no key
      await chip(w, 'HP:0001250').trigger('keydown', { key: 'Delete' })
      expect(w.emitted('update:term')).toEqual([
        [{ hpoId: 'HP:0001252', hpoLabel: 'Hypotonia', excluded: true, key: false }],
        [{ hpoId: 'HP:0001252', hpoLabel: 'Hypotonia', excluded: false, key: true }],
        [{ hpoId: 'HP:0000252', hpoLabel: 'Microcephaly', excluded: false, key: false }]
      ])
      expect(w.emitted('remove:term')).toEqual([['HP:0001250']])
    })

    it('sets status from the chip menu', async () => {
      const w = mountSelector()
      await chip(w, 'HP:0001252').trigger('click')
      await vi.waitFor(() =>
        expect(document.body.querySelector('[aria-label="Status of Hypotonia"]')).not.toBeNull()
      )
      const items = [
        ...document.body.querySelectorAll('[aria-label="Status of Hypotonia"] .v-list-item')
      ]
      const item = items.find((el) => el.textContent?.includes('Excluded (examined, absent)'))
      ;(item as HTMLElement).click()
      expect(w.emitted('update:term')).toEqual([
        [{ hpoId: 'HP:0001252', hpoLabel: 'Hypotonia', excluded: true, key: false }]
      ])
    })

    it('adds as present on Enter and as excluded on Shift+Enter', async () => {
      const w = mountSelector()
      const autocomplete = w.findComponent({ name: 'VAutocomplete' })
      const pick = { id: 'HP:0004322', name: 'Short stature' }
      await autocomplete.trigger('keydown', { key: 'Enter' })
      autocomplete.vm.$emit('update:modelValue', pick)
      await autocomplete.trigger('keydown', { key: 'Enter', shiftKey: true })
      autocomplete.vm.$emit('update:modelValue', pick)
      expect(w.emitted('add:term')).toEqual([
        [{ hpoId: 'HP:0004322', hpoLabel: 'Short stature', excluded: false, key: false }],
        [{ hpoId: 'HP:0004322', hpoLabel: 'Short stature', excluded: true, key: false }]
      ])
      expect(
        autocomplete.attributes('placeholder') ?? w.find('input').attributes('placeholder')
      ).toContain('Shift+Enter excluded')
    })
  })
})
