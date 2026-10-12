/** Window math and binning shared by the lollipop and gene-structure views. */
import { describe, expect, it } from 'vitest'

import {
  binMarkers,
  clampWindow,
  panWindow,
  windowAround,
  windowForFeature,
  zoomWindow,
  type TrackMarker
} from '../../../src/renderer/src/utils/track-window'

const extent = { start: 0, end: 1000 }

describe('clampWindow', () => {
  it.each([
    ['inside', { start: 100, end: 200 }, { start: 100, end: 200 }],
    ['past the end: slides back', { start: 950, end: 1050 }, { start: 900, end: 1000 }],
    ['before the start: slides forward', { start: -50, end: 50 }, { start: 0, end: 100 }],
    ['wider than the extent: the extent', { start: -10, end: 2000 }, extent],
    [
      'narrower than the minimum: widened around its centre',
      { start: 500, end: 502 },
      { start: 496, end: 506 }
    ]
  ])('%s', (_n, win, expected) => {
    expect(clampWindow(win, extent, 10)).toEqual(expected)
  })
})

describe('zoomWindow / panWindow', () => {
  it('zooms in around a point, keeping that point at the same place', () => {
    const next = zoomWindow({ start: 0, end: 1000 }, 2, 250, extent, 10)
    expect(next).toEqual({ start: 125, end: 625 })
  })

  it('zooms out no further than the extent', () => {
    expect(zoomWindow({ start: 400, end: 600 }, 0.01, 500, extent, 10)).toEqual(extent)
  })

  it('pans by a fraction of the window and stops at the edge', () => {
    expect(panWindow({ start: 100, end: 200 }, 0.5, extent)).toEqual({ start: 150, end: 250 })
    expect(panWindow({ start: 900, end: 1000 }, 0.5, extent)).toEqual({ start: 900, end: 1000 })
  })
})

describe('windowAround / windowForFeature', () => {
  it('centres ± half-width on a position', () => {
    expect(windowAround(180, 25, extent, 10)).toEqual({ start: 155, end: 205 })
  })

  it('frames a feature with a margin', () => {
    expect(windowForFeature({ start: 100, end: 200 }, extent, 10)).toEqual({ start: 90, end: 210 })
  })
})

describe('binMarkers', () => {
  const marker = (position: number, over: Partial<TrackMarker> = {}): TrackMarker => ({
    key: `m${position}-${over.track ?? 'variant'}`,
    position,
    track: 'variant',
    label: `p.${position}`,
    weight: 1,
    color: '#000',
    ...over
  })

  it('keeps every marker when few are in view', () => {
    const markers = [marker(10), marker(20)]
    expect(binMarkers(markers, extent, 600, { maxUnbinned: 5, binPx: 6 })).toEqual(markers)
  })

  it('bins per track when many are in view, summing their weight', () => {
    const markers = [marker(1), marker(2), marker(3, { weight: 4 }), marker(900)]
    const bins = binMarkers(markers, extent, 100, { maxUnbinned: 2, binPx: 10 })
    // 100 px / 10 px = 10 bins of 100 aa
    expect(bins.map((b) => [b.position, b.weight, b.binnedKeys?.length])).toEqual([
      [50, 6, 3],
      [950, 1, 1]
    ])
  })

  it('never bins the variant of interest and drops markers outside the window', () => {
    const anchor = marker(2, { isAnchor: true })
    const markers = [marker(1), anchor, marker(3), marker(1500)]
    const bins = binMarkers(markers, extent, 100, { maxUnbinned: 1, binPx: 10 })
    expect(bins).toContainEqual(anchor)
    expect(bins.find((b) => b.position === 1500)).toBeUndefined()
    expect(bins.filter((b) => b.binnedKeys !== undefined).map((b) => b.weight)).toEqual([2])
  })
})
