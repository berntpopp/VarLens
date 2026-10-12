/** Layout rules of the track plots: no overlapping domains or exon labels, no repeated ticks (#571). */
import { describe, expect, it } from 'vitest'

import {
  assignLanes,
  fitLabel,
  genomicTickLabels,
  placeLabels
} from '../../../src/renderer/src/utils/track-layout'

describe('assignLanes', () => {
  it('puts overlapping features on separate lanes, reusing a lane once it is free', () => {
    const lanes = assignLanes([
      { key: 'a', start: 0, end: 100 },
      { key: 'b', start: 50, end: 150 },
      { key: 'c', start: 120, end: 200 },
      { key: 'd', start: 10, end: 20 }
    ])
    expect(lanes).toEqual(
      new Map([
        ['a', 0],
        ['d', 1],
        ['b', 1],
        ['c', 0]
      ])
    )
  })
})

describe('fitLabel', () => {
  it.each([
    ['THO complex subunit 5 domain', 300, 'THO complex subunit 5 domain'],
    ['THO complex subunit 5 domain', 60, 'THO com…'],
    ['Coiled coil', 12, '']
  ])('%s in %ipx → %s', (text, px, expected) => {
    expect(fitLabel(text, px, 7)).toBe(expected)
  })
})

describe('placeLabels', () => {
  it('drops a label that would collide with the one before it (exon numbers on a 50+ exon gene)', () => {
    const shown = placeLabels(
      [
        { key: '1', x: 10, width: 8 },
        { key: '2', x: 14, width: 8 },
        { key: '3', x: 30, width: 8 },
        { key: '4', x: 33, width: 8 }
      ],
      4
    )
    expect(shown).toEqual(['1', '3'])
  })
})

describe('genomicTickLabels', () => {
  it('never repeats a label for ticks a few kb apart in a Mb-scale window (#571)', () => {
    const ticks = [29_500_000, 29_505_000, 29_510_000, 29_515_000, 29_520_000]
    const labels = genomicTickLabels(ticks)
    expect(new Set(labels).size).toBe(ticks.length)
    expect(labels).toEqual(['29.500 Mb', '29.505 Mb', '29.510 Mb', '29.515 Mb', '29.520 Mb'])
  })

  it('uses kb and bp when the window is small', () => {
    expect(genomicTickLabels([29_539_390, 29_539_395, 29_539_400])).toEqual([
      '29,539,390',
      '29,539,395',
      '29,539,400'
    ])
    expect(genomicTickLabels([900, 1000])).toEqual(['900', '1,000'])
  })
})
