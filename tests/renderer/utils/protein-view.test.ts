/** Protein view entry points: availability, the strip summary and the lollipop variants. */
import { describe, expect, it } from 'vitest'

import {
  buildLollipopVariants,
  proteinStripSummary,
  proteinViewBlockedReason
} from '../../../src/renderer/src/utils/protein-view'
import { groupLollipopsByPosition } from '../../../src/renderer/src/composables/useLollipopPlot'
import { PROTEIN_VIEW_COPY } from '../../../src/renderer/src/config/proteinViewConfig'
import type { CohortVariant } from '../../../src/shared/types/cohort'

const row = (over: Partial<CohortVariant>): CohortVariant =>
  ({
    chr: 'chr22',
    pos: 100,
    ref: 'A',
    alt: 'G',
    gene_symbol: 'THOC5',
    aa_change: 'p.Met180Val',
    consequence: 'MODERATE',
    carrier_count: 1,
    gnomad_af: null,
    clinvar: null,
    ...over
  }) as CohortVariant

describe('proteinViewBlockedReason', () => {
  it.each([
    ['lookups off', row({}), false, PROTEIN_VIEW_COPY.lookupsOff],
    ['no gene', row({ gene_symbol: null }), true, PROTEIN_VIEW_COPY.noGene],
    ['no protein position', row({ aa_change: null }), true, PROTEIN_VIEW_COPY.noProteinPosition],
    ['available', row({}), true, null]
  ])('%s', (_name, variant, lookupsOn, expected) => {
    expect(proteinViewBlockedReason(variant, lookupsOn)).toBe(expected)
  })

  it('reads the protein position from the cDNA column when aa_change has none', () => {
    expect(
      proteinViewBlockedReason(row({ aa_change: null, cdna: 'p.Arg42*' } as never), true)
    ).toBe(null)
  })

  it('no variant: blocked', () => {
    expect(proteinViewBlockedReason(null, true)).toBe(PROTEIN_VIEW_COPY.noVariant)
  })
})

describe('proteinStripSummary', () => {
  const domains = [
    { accession: 'IPR1', name: 'THOC5 domain', type: 'domain', start: 150, end: 200 }
  ]

  it('names the domain the variant falls in', () => {
    expect(proteinStripSummary(180, 683, domains)).toBe('Variant at p.180 of 683 in THOC5 domain')
  })

  it('says when no annotated domain covers the position', () => {
    expect(proteinStripSummary(20, 683, domains)).toBe(
      'Variant at p.20 of 683 in no annotated domain'
    )
  })
})

describe('buildLollipopVariants (cohort carriers)', () => {
  const selected = row({ pos: 100, carrier_count: 3 })

  it('marks the selected variant and carries every row its carrier count', () => {
    const others = [selected, row({ pos: 200, aa_change: 'p.Arg300Gln', carrier_count: 5 })]
    const result = buildLollipopVariants(selected, others, 'THOC5')
    expect(result.map((v) => [v.proteinPosition, v.carrierCount, v.highlighted])).toEqual([
      [180, 3, true],
      [300, 5, false]
    ])
  })

  it('leaves out rows without a protein position and rows of another gene', () => {
    const others = [
      row({ pos: 300, aa_change: null }),
      row({ pos: 400, gene_symbol: 'OTHER', aa_change: 'p.Gly5Asp' })
    ]
    expect(buildLollipopVariants(selected, others, 'THOC5')).toHaveLength(1)
  })

  it('case variants carry no carrier count', () => {
    const caseVariant = { ...row({}), carrier_count: undefined } as unknown as CohortVariant
    expect(buildLollipopVariants(caseVariant, [], 'THOC5')[0].carrierCount).toBeUndefined()
  })
})

describe('groupLollipopsByPosition', () => {
  it('sums carriers of the variants at one position (count = carriers, else variants)', () => {
    const variants = buildLollipopVariants(
      null,
      [
        row({ pos: 1, aa_change: 'p.Met180Val', carrier_count: 2 }),
        row({ pos: 2, aa_change: 'p.Met180Ile', carrier_count: 4 }),
        row({ pos: 3, aa_change: 'p.Arg300Gln', carrier_count: 1 })
      ],
      'THOC5'
    )
    const groups = groupLollipopsByPosition(variants)
    expect(groups.map((g) => [g.position, g.count, g.variants.length])).toEqual([
      [180, 6, 2],
      [300, 1, 1]
    ])
  })
})
