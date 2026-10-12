/** Lollipop / ClinVar / gnomAD rows → the markers and features of each view. */
import { describe, expect, it } from 'vitest'

import { geneTrackData, proteinTrackData } from '../../../src/renderer/src/utils/track-markers'
import type {
  ClinVarVariant,
  GnomadVariant,
  LollipopVariant
} from '../../../src/shared/types/protein'

const lolli = (over: Partial<LollipopVariant>): LollipopVariant =>
  ({
    proteinPosition: 180,
    aaChange: 'p.Met180Val',
    consequence: 'missense_variant',
    consequenceCategory: 'missense',
    color: '#008000',
    geneSymbol: 'THOC5',
    chr: 'chr22',
    pos: 29539391,
    ref: 'T',
    alt: 'C',
    gnomadAf: null,
    cadd: null,
    clinvar: null,
    ...over
  }) as LollipopVariant

const clinvar = (over: Partial<ClinVarVariant>): ClinVarVariant => ({
  variantId: '22-1-A-G',
  clinicalSignificance: 'Pathogenic',
  clinvarVariationId: '1',
  goldStars: 2,
  proteinPosition: 200,
  hgvsp: 'p.Arg200Gln',
  consequence: 'missense_variant',
  alleleFrequency: null,
  genomicPosition: 29540000,
  ...over
})

const gnomad = (over: Partial<GnomadVariant>): GnomadVariant => ({
  variantId: '22-2-C-T',
  proteinPosition: 50,
  hgvsp: 'p.Ala50Thr',
  consequence: 'missense_variant',
  alleleFrequency: 0.001,
  alleleCount: 3,
  alleleNumber: 3000,
  ...over
})

describe('proteinTrackData', () => {
  const data = proteinTrackData({
    variants: [
      lolli({ highlighted: true, carrierCount: 3 }),
      lolli({ pos: 2, proteinPosition: 300, aaChange: 'p.Arg300Gln', carrierCount: 5 }),
      lolli({ pos: 3, proteinPosition: 400, aaChange: 'p.Gly400Asp' })
    ],
    clinvar: [clinvar({}), clinvar({ variantId: 'x', proteinPosition: null })],
    gnomad: [gnomad({}), gnomad({ variantId: 'y', proteinPosition: null })],
    domains: [{ accession: 'IPR1', name: 'THO', type: 'domain', start: 150, end: 250 }]
  })

  it('the selected variant is the anchor; cohort rows weigh their carriers', () => {
    expect(
      data.markers
        .filter((m) => m.track !== 'clinvar' && m.track !== 'gnomad')
        .map((m) => [m.position, m.track, m.weight, m.isAnchor === true])
    ).toEqual([
      [180, 'cohort', 3, true],
      [300, 'cohort', 5, false],
      [400, 'variant', 1, false]
    ])
  })

  it('ClinVar and gnomAD rows without a protein position are left out', () => {
    expect(
      data.markers
        .filter((m) => m.track === 'clinvar')
        .map((m) => [m.position, m.clinvarClass, m.stars])
    ).toEqual([[200, 'pathogenic', 2]])
    expect(data.markers.filter((m) => m.track === 'gnomad').map((m) => m.position)).toEqual([50])
  })

  it('domains become features', () => {
    expect(data.features).toEqual([
      expect.objectContaining({ key: 'IPR1-150', name: 'THO', start: 150, end: 250 })
    ])
  })
})

describe('geneTrackData', () => {
  it('places variants and ClinVar at their genomic position; the anchor comes from the genomic variant', () => {
    const data = geneTrackData({
      variants: [lolli({ highlighted: true }), lolli({ pos: 29540100, proteinPosition: 210 })],
      clinvar: [clinvar({}), clinvar({ variantId: 'z', genomicPosition: null })],
      exons: [{ start: 29539000, end: 29539500, rank: 7 }],
      anchor: {
        chr: 'chr22',
        pos: 29539391,
        ref: 'T',
        alt: 'C',
        label: 'p.Met180Val',
        color: '#D32F2F'
      }
    })
    expect(data.markers.map((m) => [m.position, m.track, m.isAnchor === true])).toEqual([
      [29539391, 'variant', true],
      [29540100, 'variant', false],
      [29540000, 'clinvar', false]
    ])
    expect(data.features).toEqual([
      { key: 'exon-7', name: 'Exon 7', start: 29539000, end: 29539500 }
    ])
  })

  it('an SV anchor sits at its start', () => {
    const data = geneTrackData({
      variants: [],
      clinvar: [],
      exons: [],
      anchor: {
        chr: 'chr1',
        pos: 1000,
        end: 6000,
        ref: 'N',
        alt: '<DEL>',
        label: 'DEL',
        color: '#D32F2F'
      }
    })
    expect(data.markers).toEqual([
      expect.objectContaining({ position: 1000, isAnchor: true, label: 'DEL' })
    ])
  })
})
