/** The navigator both views share: framing the variant of interest, keys, search hits. */
import { describe, expect, it } from 'vitest'
import { nextTick, ref } from 'vue'

import { useTrackNavigator } from '../../../src/renderer/src/composables/useTrackNavigator'
import { NEIGHBOURHOOD_HALF_WIDTHS, ZOOM_STEP } from '../../../src/renderer/src/config/proteinPlotConfig'
import type { TrackFeature, TrackMarker } from '../../../src/renderer/src/utils/track-window'

const m = (key: string, position: number, over: Partial<TrackMarker> = {}): TrackMarker => ({
  key,
  position,
  track: 'variant',
  label: key,
  weight: 1,
  color: '#000',
  ...over
})

function setup(markers: TrackMarker[] = [m('anchor', 180, { isAnchor: true }), m('b', 300), m('c', 600)]) {
  const features = ref<TrackFeature[]>([{ key: 'd', name: 'THO', start: 150, end: 250 }])
  const nav = useTrackNavigator({
    view: 'protein',
    extent: ref({ start: 0, end: 683 }),
    markers: ref(markers),
    features
  })
  return nav
}

const key = (k: string, over: Partial<KeyboardEventInit> = {}) =>
  new KeyboardEvent('keydown', { key: k, cancelable: true, ...over })

describe('useTrackNavigator', () => {
  const half = NEIGHBOURHOOD_HALF_WIDTHS.protein[0]

  it('opens on the neighbourhood of the variant of interest', async () => {
    const nav = setup()
    await nextTick()
    expect(nav.window.value).toEqual({ start: 180 - half, end: 180 + half })
    expect(nav.neighbourhood.value?.feature?.name).toBe('THO')
  })

  it('without a variant of interest it shows the whole axis', async () => {
    const nav = setup([m('b', 300)])
    await nextTick()
    expect(nav.window.value).toEqual({ start: 0, end: 683 })
    expect(nav.neighbourhood.value).toBeNull()
  })

  it('keys: + zooms in, − out, ←/→ pan, Home shows everything', async () => {
    const nav = setup()
    await nextTick()
    const start = nav.window.value
    nav.onKeydown(key('-'))
    expect(nav.window.value.end - nav.window.value.start).toBeCloseTo((start.end - start.start) * ZOOM_STEP)
    nav.onKeydown(key('+'))
    nav.onKeydown(key('ArrowRight'))
    expect(nav.window.value.start).toBeGreaterThan(start.start)
    nav.onKeydown(key('Home'))
    expect(nav.window.value).toEqual({ start: 0, end: 683 })
  })

  it('leaves Ctrl/Cmd/Alt combinations to the browser', async () => {
    const nav = setup()
    await nextTick()
    const before = nav.window.value
    const e = key('+', { ctrlKey: true })
    nav.onKeydown(e)
    expect(e.defaultPrevented).toBe(false)
    expect(nav.window.value).toEqual(before)
  })

  it('a search hit frames its target, highlights and focuses its markers', async () => {
    const nav = setup()
    await nextTick()
    nav.goTo({ key: 'x', label: 'p.600', detail: '1 variant', target: 600, markerKeys: ['c'] })
    expect(nav.window.value).toEqual({ start: 600 - half, end: 600 + half })
    expect([...nav.highlighted.value]).toEqual(['c'])
    expect(nav.focusedKey.value).toBe('c')
    nav.goTo({ key: 'd', label: 'THO', detail: '', target: { start: 150, end: 250 }, markerKeys: [] })
    expect(nav.window.value).toEqual({ start: 140, end: 260 })
  })

  it('changes the variant of interest and goes back to the original', async () => {
    const nav = setup()
    await nextTick()
    nav.setAnchor('b')
    expect(nav.anchor.value?.key).toBe('b')
    expect(nav.displayMarkers.value.filter((x) => x.isAnchor).map((x) => x.key)).toEqual(['b'])
    expect(nav.window.value).toEqual({ start: 300 - half, end: 300 + half })
    nav.resetAnchor()
    expect(nav.anchor.value?.key).toBe('anchor')
  })

  it('a wider neighbourhood re-frames the variant of interest', async () => {
    const nav = setup()
    await nextTick()
    nav.setHalfWidth(50)
    expect(nav.window.value).toEqual({ start: 130, end: 230 })
  })

  it('steps through the visible markers in position order', async () => {
    const nav = setup()
    await nextTick()
    nav.onKeydown(key('Home'))
    nav.focusedKey.value = 'anchor'
    expect(nav.stepFocus(1)).toBe('b')
    expect(nav.stepFocus(1)).toBe('c')
    expect(nav.stepFocus(1)).toBe('c')
    expect(nav.stepFocus(-1)).toBe('b')
  })
})
