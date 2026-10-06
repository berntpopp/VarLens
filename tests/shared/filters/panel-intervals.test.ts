import { describe, expect, it } from 'vitest'

import {
  buildPaddedPanelIntervals,
  mergeOverlappingIntervals
} from '../../../src/shared/filters/panel-intervals'

describe('buildPaddedPanelIntervals', () => {
  it('pads both sides of every gene and clamps the start at 1', () => {
    expect(
      buildPaddedPanelIntervals(
        [
          { chromosome: '7', start_pos: 100_000, end_pos: 200_000 },
          { chromosome: '1', start_pos: 1_000, end_pos: 2_000 }
        ],
        5_000,
        false
      )
    ).toEqual([
      { chr: '1', start: 1, end: 7_000 },
      { chr: '7', start: 95_000, end: 205_000 }
    ])
  })

  it('emits regions in the chromosome naming style of the variant data', () => {
    const coordinates = [
      { chromosome: '7', start_pos: 10, end_pos: 20 },
      { chromosome: 'chrX', start_pos: 10, end_pos: 20 }
    ]
    expect(buildPaddedPanelIntervals(coordinates, 0, true).map((iv) => iv.chr)).toEqual([
      'chr7',
      'chrX'
    ])
    expect(buildPaddedPanelIntervals(coordinates, 0, false).map((iv) => iv.chr)).toEqual([
      '7',
      'chrX'
    ])
  })

  it('merges genes whose padded regions overlap or touch', () => {
    expect(
      buildPaddedPanelIntervals(
        [
          { chromosome: '7', start_pos: 100, end_pos: 200 },
          { chromosome: '7', start_pos: 221, end_pos: 300 },
          { chromosome: '7', start_pos: 500, end_pos: 600 }
        ],
        10,
        false
      )
    ).toEqual([
      { chr: '7', start: 90, end: 310 },
      { chr: '7', start: 490, end: 610 }
    ])
  })
})

describe('mergeOverlappingIntervals', () => {
  it('returns an empty list unchanged and does not mutate its input', () => {
    expect(mergeOverlappingIntervals([])).toEqual([])
    const input = [
      { chr: '2', start: 5, end: 9 },
      { chr: '2', start: 1, end: 6 }
    ]
    expect(mergeOverlappingIntervals(input)).toEqual([{ chr: '2', start: 1, end: 9 }])
    expect(input[1]).toEqual({ chr: '2', start: 1, end: 6 })
  })
})
