/** The view search box: Enter goes to the hit, n of m steps through hits, Esc clears. */
import { afterEach, describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { nextTick, ref } from 'vue'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'

import TrackSearch from '../../../../../src/renderer/src/components/protein/track/TrackSearch.vue'
import { useTrackNavigator } from '../../../../../src/renderer/src/composables/useTrackNavigator'
import type { TrackFeature, TrackMarker } from '../../../../../src/renderer/src/utils/track-window'

const vuetify = createVuetify({ components, directives })

const markers: TrackMarker[] = [
  {
    key: 'a',
    position: 180,
    track: 'variant',
    label: 'p.Met180Val',
    aaChange: 'p.Met180Val',
    weight: 1,
    color: '#000',
    isAnchor: true
  }
]
const features: TrackFeature[] = [
  { key: 'd1', name: 'Coiled coil 1', start: 300, end: 340 },
  { key: 'd2', name: 'Coiled coil 2', start: 500, end: 540 }
]

async function mountSearch() {
  const nav = useTrackNavigator({
    view: 'protein',
    extent: ref({ start: 0, end: 683 }),
    markers: ref(markers),
    features: ref(features)
  })
  await nextTick()
  const wrapper = mount(TrackSearch, {
    props: {
      nav,
      context: { view: 'protein', markers, features, extentEnd: 683 },
      label: 'Find',
      hint: 'e.g.'
    },
    global: { plugins: [vuetify] },
    attachTo: document.body
  })
  return { nav, wrapper, input: wrapper.get('input') }
}

describe('TrackSearch', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('Enter goes to the first hit; the arrows step through the others', async () => {
    const { nav, wrapper, input } = await mountSearch()
    await input.setValue('coiled')
    await input.trigger('keydown', { key: 'Enter' })
    expect(nav.window.value).toEqual({ start: 296, end: 344 })
    expect(wrapper.text()).toContain('1 of 2')
    await wrapper.get('button[aria-label="Next match"]').trigger('click')
    expect(nav.window.value).toEqual({ start: 496, end: 544 })
    expect(wrapper.text()).toContain('2 of 2')
  })

  it('a change highlights and focuses its variant; Esc clears the highlight', async () => {
    const { nav, input } = await mountSearch()
    await input.setValue('M180V')
    await input.trigger('keydown', { key: 'Enter' })
    expect([...nav.highlighted.value]).toEqual(['a'])
    expect(nav.focusedKey.value).toBe('a')
    await input.trigger('keydown', { key: 'Escape' })
    await flushPromises()
    expect(nav.highlighted.value.size).toBe(0)
    expect((input.element as HTMLInputElement).value).toBe('')
  })

  it('one always-present status region announces "No match" and "n of m"', async () => {
    const { wrapper, input } = await mountSearch()
    const status = () => wrapper.get('[role="status"]')
    expect(status().text()).toBe('')
    await input.setValue('kinase')
    expect(status().text()).toBe('No match')
    await input.setValue('coiled')
    await input.trigger('keydown', { key: 'Enter' })
    expect(status().text()).toBe('1 of 2')
    expect(wrapper.findAll('[role="status"]')).toHaveLength(1)
  })
})
