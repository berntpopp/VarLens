/** The variant-of-interest neighbourhood: where it lies and what is around it. */
import { describe, expect, it } from 'vitest'

import {
  locationLine,
  formatHalfWidth,
  neighbourhoodLine,
  neighbourhoodSummary
} from '../../../src/renderer/src/utils/track-neighbourhood'
import type { TrackFeature, TrackMarker } from '../../../src/renderer/src/utils/track-window'

const m = (key: string, position: number, over: Partial<TrackMarker> = {}): TrackMarker => ({
  key,
  position,
  track: 'clinvar',
  label: key,
  weight: 1,
  color: '#000',
  ...over
})

const domains: TrackFeature[] = [
  { key: 'd1', name: 'THO domain', start: 150, end: 250 },
  { key: 'd2', name: 'Coiled coil', start: 400, end: 450 }
]

const markers: TrackMarker[] = [
  m('anchor', 180, { track: 'variant', isAnchor: true }),
  m('p1', 170, { clinvarClass: 'pathogenic' }),
  m('p2', 190, { clinvarClass: 'pathogenic' }),
  m('lp', 200, { clinvarClass: 'likely_pathogenic' }),
  m('vus', 181, { clinvarClass: 'uncertain' }),
  m('far', 300, { clinvarClass: 'benign' }),
  m('c1', 175, { track: 'cohort', weight: 3 }),
  m('c2', 205, { track: 'cohort', weight: 6 }),
  m('gn', 180, { track: 'gnomad' })
]

describe('neighbourhoodSummary', () => {
  const s = neighbourhoodSummary({ anchor: 180, half: 25, features: domains, markers })

  it('the window is ± half around the anchor', () => {
    expect(s.window).toEqual({ start: 155, end: 205 })
  })

  it('names the containing domain and the distance to its nearest boundary', () => {
    expect(s.feature?.key).toBe('d1')
    expect(s.boundaryDistance).toBe(30)
  })

  it('groups the ClinVar variants in the window by class, worst first', () => {
    expect(s.clinvar.map((g) => [g.cls, g.keys])).toEqual([
      ['pathogenic', ['p1', 'p2']],
      ['likely_pathogenic', ['lp']],
      ['uncertain', ['vus']]
    ])
  })

  it('counts cohort variants and their carriers in the window', () => {
    expect(s.cohort).toEqual({ variants: 2, carriers: 9, keys: ['c1', 'c2'] })
  })

  it('lists nearby variants by distance from the anchor, without the anchor or gnomAD', () => {
    expect(s.nearby.map((n) => [n.marker.key, n.distance])).toEqual([
      ['vus', 1],
      ['c1', -5],
      ['p1', -10],
      ['p2', 10],
      ['lp', 20],
      ['c2', 25]
    ])
  })

  it('between domains: the nearest domain on each side and the distance to the closer one', () => {
    const b = neighbourhoodSummary({ anchor: 330, half: 25, features: domains, markers })
    expect([b.feature, b.before?.key, b.after?.key, b.boundaryDistance]).toEqual([
      null,
      'd1',
      'd2',
      70
    ])
  })

  it('no domains at all: no location, no distance', () => {
    const n = neighbourhoodSummary({ anchor: 10, half: 5, features: [], markers: [] })
    expect([n.feature, n.before, n.after, n.boundaryDistance, n.nearby]).toEqual([
      null,
      null,
      null,
      null,
      []
    ])
  })
})

describe('a CNV/SV interval as the variant of interest', () => {
  const exons: TrackFeature[] = [
    { key: 'e1', name: 'Exon 1', start: 900, end: 1100 },
    { key: 'e2', name: 'Exon 2', start: 3000, end: 3200 },
    { key: 'e3', name: 'Exon 3', start: 8000, end: 8100 }
  ]
  const markers: TrackMarker[] = [
    m('del', 1000, { track: 'variant', isAnchor: true, end: 5000 }),
    m('inside', 2000, { clinvarClass: 'pathogenic' }),
    m('after', 5300, { clinvarClass: 'benign' }),
    m('far', 7000, { clinvarClass: 'benign' })
  ]
  const s = neighbourhoodSummary({
    anchor: 1000,
    anchorEnd: 5000,
    half: 500,
    features: exons,
    markers
  })

  it('the window runs from half before its start to half after its end', () => {
    expect(s.window).toEqual({ start: 500, end: 5500 })
  })

  it('counts the variants inside the interval (distance 0) and near it', () => {
    expect(s.nearby.map((n) => [n.marker.key, n.distance])).toEqual([
      ['inside', 0],
      ['after', 300]
    ])
    expect(s.clinvar.map((g) => [g.cls, g.keys])).toEqual([
      ['pathogenic', ['inside']],
      ['benign', ['after']]
    ])
  })

  it('says which features it spans or overlaps', () => {
    expect(s.spans?.map((f) => f.key)).toEqual(['e1', 'e2'])
    expect(locationLine(s, 'bp', 'in an intron', 'no exon data', 'outside the gene')).toBe(
      'Spans Exon 1 – Exon 2 (2)'
    )
    const one = neighbourhoodSummary({
      anchor: 3100,
      anchorEnd: 3150,
      half: 10,
      features: exons,
      markers: []
    })
    expect(locationLine(one, 'bp', 'in an intron', 'no exon data', 'outside the gene')).toBe(
      'Overlaps Exon 2'
    )
    const none = neighbourhoodSummary({
      anchor: 1500,
      anchorEnd: 2500,
      half: 10,
      features: exons,
      markers: []
    })
    expect(locationLine(none, 'bp', 'in an intron', 'no exon data', 'outside the gene')).toBe(
      'In an intron'
    )
  })

  it('says when it reaches past the gene', () => {
    const big = neighbourhoodSummary({
      anchor: 0,
      anchorEnd: 20000,
      half: 500,
      features: exons,
      markers: [],
      extent: { start: 800, end: 9000 }
    })
    expect(locationLine(big, 'bp', 'in an intron', 'no exon data', 'outside the gene')).toBe(
      'Spans Exon 1 – Exon 3 (3) · reaches outside the gene'
    )
  })
})

describe('summary lines', () => {
  const s = neighbourhoodSummary({ anchor: 180, half: 25, features: domains, markers })

  it('one line of counts', () => {
    expect(neighbourhoodLine(s, 25, 'aa')).toBe(
      '±25 aa: 2 Pathogenic, 1 Likely pathogenic, 1 VUS · 2 cohort variants, 9 carriers'
    )
  })

  it('where the variant lies', () => {
    expect(locationLine(s, 'aa', 'between domains')).toBe('In THO domain · 30 aa to its edge')
    const b = neighbourhoodSummary({ anchor: 330, half: 25, features: domains, markers })
    expect(locationLine(b, 'aa', 'between domains')).toBe('Between domains · 70 aa to Coiled coil')
  })

  it('no domains at all: says so instead of "between domains"', () => {
    const none = neighbourhoodSummary({ anchor: 180, half: 25, features: [], markers })
    expect(locationLine(none, 'aa', 'between domains', 'no annotated domains')).toBe(
      'No annotated domains'
    )
  })

  it.each([
    [25, 'aa', '±25 aa'],
    [500, 'bp', '±500 bp'],
    [2000, 'bp', '±2 kb'],
    [50000, 'bp', '±50 kb']
  ] as const)('half-width %i %s reads %s', (half, unit, expected) => {
    expect(formatHalfWidth(half, unit)).toBe(expected)
  })

  it('an empty window says so', () => {
    const e = neighbourhoodSummary({ anchor: 600, half: 10, features: domains, markers })
    expect(neighbourhoodLine(e, 10, 'aa')).toBe('±10 aa: no other variants')
  })
})
