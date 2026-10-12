/** One search box for both views: what each input means and what it finds. */
import { describe, expect, it } from 'vitest'

import {
  normaliseAaChange,
  parseTrackQuery,
  searchTrack
} from '../../../src/renderer/src/utils/track-search'
import type { TrackFeature, TrackMarker } from '../../../src/renderer/src/utils/track-window'

describe('parseTrackQuery', () => {
  it.each([
    ['180', { kind: 'position', position: 180 }],
    ['p.180', { kind: 'position', position: 180 }],
    ['Met180Val', { kind: 'aa-change', change: 'M180V', position: 180 }],
    ['M180V', { kind: 'aa-change', change: 'M180V', position: 180 }],
    ['p.Met180Val', { kind: 'aa-change', change: 'M180V', position: 180 }],
    ['p.Arg42Ter', { kind: 'aa-change', change: 'R42*', position: 42 }],
    ['R42*', { kind: 'aa-change', change: 'R42*', position: 42 }],
    ['c.538A>G', { kind: 'cdna', cdna: 'c.538a>g' }],
    ['exon 5', { kind: 'exon', rank: 5 }],
    ['e12', { kind: 'exon', rank: 12 }],
    ['chr22:29539391', { kind: 'genomic', chr: '22', pos: 29539391 }],
    ['22:29,539,391', { kind: 'genomic', chr: '22', pos: 29539391 }],
    ['coiled', { kind: 'name', text: 'coiled' }],
    ['  THO ', { kind: 'name', text: 'tho' }],
    ['', null],
    ['Xyz180Val', { kind: 'name', text: 'xyz180val' }]
  ])('%s', (input, expected) => {
    expect(parseTrackQuery(input)).toEqual(expected)
  })
})

describe('normaliseAaChange', () => {
  it.each([
    ['ENSP00000420306.1:p.Met180Val', 'M180V'],
    ['p.(Arg42Ter)', 'R42*'],
    ['p.R248W', 'R248W'],
    [null, null],
    ['p.?', null]
  ])('%s → %s', (input, expected) => {
    expect(normaliseAaChange(input)).toBe(expected)
  })
})

const marker = (over: Partial<TrackMarker>): TrackMarker => ({
  key: 'k',
  position: 0,
  track: 'variant',
  label: '',
  weight: 1,
  color: '#000',
  ...over
})

const markers: TrackMarker[] = [
  marker({
    key: 'a',
    position: 180,
    aaChange: 'p.Met180Val',
    cdna: 'c.538A>G',
    chr: 'chr22',
    pos: 29539391
  }),
  marker({ key: 'b', position: 180, aaChange: 'p.Met180Ile', track: 'clinvar' }),
  marker({ key: 'c', position: 300, aaChange: 'p.Arg300Gln', track: 'cohort', weight: 4 })
]
const domains: TrackFeature[] = [
  { key: 'd1', name: 'THO complex domain', start: 150, end: 250 },
  { key: 'd2', name: 'Coiled coil', start: 400, end: 450 }
]

describe('searchTrack (protein view)', () => {
  const run = (q: string) =>
    searchTrack(parseTrackQuery(q), { view: 'protein', markers, features: domains })

  it('a position finds every variant there', () => {
    expect(run('p.180')).toEqual([
      { key: 'pos-180', label: 'p.180', detail: '2 variants', target: 180, markerKeys: ['a', 'b'] }
    ])
  })

  it('a change finds the matching variant in either notation', () => {
    expect(run('M180V').map((m) => m.markerKeys)).toEqual([['a']])
    expect(run('Met180Val').map((m) => m.markerKeys)).toEqual([['a']])
  })

  it('a change nobody carries still goes to its position', () => {
    expect(run('M180L')).toEqual([
      { key: 'pos-180', label: 'p.M180L', detail: 'no variant', target: 180, markerKeys: [] }
    ])
  })

  it('a domain name lists each matching domain', () => {
    expect(run('coil')).toEqual([
      {
        key: 'feature-d2',
        label: 'Coiled coil',
        detail: '400–450',
        target: { start: 400, end: 450 },
        markerKeys: []
      }
    ])
  })

  it('c. and chr:pos find the variant that carries them', () => {
    expect(run('c.538A>G').map((m) => m.markerKeys)).toEqual([['a']])
    expect(run('chr22:29539391').map((m) => m.markerKeys)).toEqual([['a']])
  })

  it('a position past the protein end finds nothing', () => {
    expect(
      searchTrack(parseTrackQuery('9999'), {
        view: 'protein',
        markers,
        features: domains,
        extentEnd: 683
      })
    ).toEqual([])
  })
})

describe('searchTrack (gene view)', () => {
  const exons: TrackFeature[] = [
    { key: 'e1', name: 'Exon 1', start: 1000, end: 1100 },
    { key: 'e5', name: 'Exon 5', start: 5000, end: 5200 }
  ]
  const geneMarkers = [
    marker({
      key: 'a',
      position: 5100,
      proteinPosition: 180,
      aaChange: 'p.Met180Val',
      chr: 'chr22',
      pos: 5100
    })
  ]

  it('an exon number goes to that exon', () => {
    expect(
      searchTrack(parseTrackQuery('exon 5'), {
        view: 'gene',
        markers: geneMarkers,
        features: exons
      }).map((m) => m.target)
    ).toEqual([{ start: 5000, end: 5200 }])
  })

  it('a protein position finds the variant at that residue', () => {
    expect(
      searchTrack(parseTrackQuery('180'), {
        view: 'gene',
        markers: geneMarkers,
        features: exons
      }).map((m) => [m.target, m.markerKeys])
    ).toEqual([[5100, ['a']]])
  })

  it('a genomic position goes there even without a variant', () => {
    expect(
      searchTrack(parseTrackQuery('chr22:5150'), {
        view: 'gene',
        markers: geneMarkers,
        features: exons
      })[0]
    ).toMatchObject({ target: 5150, markerKeys: [] })
  })
})
