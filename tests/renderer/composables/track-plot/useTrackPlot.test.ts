/** The plot is one Tab stop (roving tabindex) and says each step once. */
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, nextTick, ref } from 'vue'
import * as d3 from 'd3'

import { useTrackPlot } from '../../../../src/renderer/src/composables/track-plot/useTrackPlot'
import { useTrackNavigator } from '../../../../src/renderer/src/composables/useTrackNavigator'
import type { TrackMarker } from '../../../../src/renderer/src/utils/track-window'

const m = (key: string, position: number, over: Partial<TrackMarker> = {}): TrackMarker => ({
  key,
  position,
  track: 'variant',
  label: key,
  weight: 1,
  color: '#000',
  ...over
})

const frame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()))

async function setup() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  const host = document.createElement('div')
  host.tabIndex = -1
  host.appendChild(svg)
  document.body.appendChild(host)
  let api!: { nav: ReturnType<typeof useTrackNavigator>; plot: ReturnType<typeof useTrackPlot> }
  const app = createApp({
    setup() {
      const nav = useTrackNavigator({
        view: 'protein',
        extent: ref({ start: 0, end: 100 }),
        markers: ref([m('a', 20), m('anchor', 50, { isAnchor: true }), m('c', 60)]),
        features: ref([])
      })
      nav.reset()
      const plot = useTrackPlot({
        svgRef: ref(svg),
        dimensions: ref({ width: 800, height: 300 }),
        nav,
        unit: 'aa',
        deps: () => null,
        draw: (ctx) => {
          for (const marker of ctx.markers) {
            const el = ctx.root.append('g') as d3.Selection<SVGGElement, unknown, null, undefined>
            ctx.bindMarker(el, marker)
          }
        }
      })
      api = { nav, plot }
      return () => null
    }
  })
  app.mount(document.createElement('div'))
  await nextTick()
  await frame()
  const stops = () =>
    [...svg.querySelectorAll('[tabindex="0"]')].map((e) => e.getAttribute('data-key'))
  const el = (key: string) => svg.querySelector<SVGGElement>(`[data-key="${key}"]`)!
  return { ...api, svg, stops, el, unmount: () => app.unmount() }
}

describe('useTrackPlot keyboard', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('only the variant of interest is a Tab stop; the others are reached with the arrows', async () => {
    const { stops, el, unmount } = await setup()
    expect(stops()).toEqual(['anchor'])
    el('anchor').focus()
    el('anchor').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    await frame()
    expect(document.activeElement?.getAttribute('data-key')).toBe('c')
    expect(stops()).toEqual(['c'])
    unmount()
  })

  it('a focus move is not announced again; a search jump (focus stays put) is', async () => {
    const { nav, plot, el, unmount } = await setup()
    el('anchor').focus()
    el('anchor').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
    await frame()
    expect(plot.announcement.value).toBe('')
    // Searching: the keyboard focus is in the search box, not the plot.
    ;(document.activeElement as HTMLElement).blur()
    nav.goTo({ key: 'x', label: 'c', detail: '', target: 60, markerKeys: ['c'] })
    await nextTick()
    await frame()
    expect(plot.announcement.value).toContain('c')
    unmount()
  })
})
