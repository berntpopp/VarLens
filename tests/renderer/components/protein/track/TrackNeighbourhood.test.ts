/** The neighbourhood panel: counts highlight markers, co-located variants can become the anchor. */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick, ref } from 'vue'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'

import TrackNeighbourhood from '../../../../../src/renderer/src/components/protein/track/TrackNeighbourhood.vue'
import { useTrackNavigator } from '../../../../../src/renderer/src/composables/useTrackNavigator'
import type { TrackMarker } from '../../../../../src/renderer/src/utils/track-window'

const vuetify = createVuetify({ components, directives })
const m = (key: string, position: number, over: Partial<TrackMarker> = {}): TrackMarker => ({
  key,
  position,
  track: 'clinvar',
  label: key,
  weight: 1,
  color: '#000',
  ...over
})
const markers = [
  m('anchor', 180, { track: 'variant', isAnchor: true }),
  m('p1', 190, { clinvarClass: 'pathogenic' }),
  m('p2', 190, { clinvarClass: 'pathogenic' })
]

async function mountPanel() {
  const nav = useTrackNavigator({
    view: 'protein',
    extent: ref({ start: 0, end: 683 }),
    markers: ref(markers),
    features: ref([])
  })
  await nextTick()
  const wrapper = mount(TrackNeighbourhood, {
    props: {
      nav,
      unit: 'aa',
      betweenLabel: 'between domains',
      noFeaturesLabel: 'no annotated domains'
    },
    global: { plugins: [vuetify] }
  })
  return { nav, wrapper }
}

describe('TrackNeighbourhood', () => {
  it('a class count highlights its markers', async () => {
    const { nav, wrapper } = await mountPanel()
    await wrapper
      .findAll('button')
      .find((b) => b.text().includes('2 Pathogenic'))!
      .trigger('click')
    expect([...nav.highlighted.value]).toEqual(['p1', 'p2'])
  })

  it('variants at one focused position each offer "Set as variant of interest"', async () => {
    const { nav, wrapper } = await mountPanel()
    nav.focusedKey.value = 'p1'
    nav.focusedMembers.value = [markers[1], markers[2]]
    await nextTick()
    const buttons = wrapper.findAll('[data-member-key]')
    expect(buttons.map((b) => b.attributes('data-member-key'))).toEqual(['p1', 'p2'])
    await buttons[1].trigger('click')
    expect(nav.anchor.value?.key).toBe('p2')
  })
})
