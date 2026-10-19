/** Protein view entry points: availability, the strip summary and the lollipop variants. */
import { describe, expect, it } from 'vitest'

import {
  buildLollipopVariants,
  proteinStripSummary,
  proteinTabReason,
  proteinViewBlockedReason,
  proteinViewTabFor,
  resolveVariantConsequence
} from '../../../src/renderer/src/utils/protein-view'
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
    [
      'lookups off: the server reason',
      row({}),
      'Turned off on this server',
      'Turned off on this server'
    ],
    ['no gene', row({ gene_symbol: null }), null, PROTEIN_VIEW_COPY.noGene],
    // SV / intronic / splice / UTR: the gene structure still shows them.
    ['no protein position', row({ aa_change: null }), null, null],
    ['available', row({}), null, null]
  ])('%s', (_name, variant, lookupsReason, expected) => {
    expect(proteinViewBlockedReason(variant, lookupsReason)).toBe(expected)
  })

  it('no variant: blocked', () => {
    expect(proteinViewBlockedReason(null, null)).toBe(PROTEIN_VIEW_COPY.noVariant)
  })
})

describe('protein tabs for a variant', () => {
  const noPosition = row({ aa_change: null })

  it.each([
    ['lollipop', row({}), 'lollipop', null],
    ['3d', row({}), '3d', null],
    ['lollipop', noPosition, 'gene-structure', PROTEIN_VIEW_COPY.noProteinPosition],
    ['3d', noPosition, 'gene-structure', PROTEIN_VIEW_COPY.noProteinPosition],
    ['gene-structure', noPosition, 'gene-structure', null]
  ] as const)('%s: opens %s', (tab, variant, opened, reason) => {
    expect(proteinViewTabFor(variant, tab)).toBe(opened)
    expect(proteinTabReason(variant, tab)).toBe(reason)
  })

  it('reads the protein position from the cDNA column when aa_change has none', () => {
    const v = row({ aa_change: null, cdna: 'p.Arg42*' } as never)
    expect(proteinViewTabFor(v, 'lollipop')).toBe('lollipop')
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

  it('uses SO consequence term (v.func) when available, falling back to v.consequence (#664)', () => {
    const withFunc = row({
      func: 'inframe_deletion',
      consequence: 'MODERATE'
    })
    const resultFunc = buildLollipopVariants(withFunc, [], 'THOC5')
    expect(resultFunc[0].consequence).toBe('inframe_deletion')
    expect(resultFunc[0].consequenceCategory).toBe('inframe')
    expect(resultFunc[0].color).toBe('#7B3294')

    const withoutFunc = row({
      func: null,
      consequence: 'MODERATE'
    })
    const resultFallback = buildLollipopVariants(withoutFunc, [], 'THOC5')
    expect(resultFallback[0].consequence).toBe('MODERATE')
    expect(resultFallback[0].consequenceCategory).toBe('missense')
  })

  it('handles combined SO terms and impact fallback in resolveVariantConsequence (#664)', () => {
    // Combined VEP SO terms: missense_variant&splice_region_variant -> missense
    const combinedMissense = row({
      func: 'missense_variant&splice_region_variant',
      consequence: 'MODERATE'
    })
    expect(resolveVariantConsequence(combinedMissense)).toBe('missense_variant')
    const resCombinedMissense = buildLollipopVariants(combinedMissense, [], 'THOC5')
    expect(resCombinedMissense[0].consequenceCategory).toBe('missense')

    // Combined VEP SO terms: splice_region_variant&intron_variant -> splice
    const combinedSplice = row({
      func: 'splice_region_variant&intron_variant',
      consequence: 'LOW'
    })
    expect(resolveVariantConsequence(combinedSplice)).toBe('splice_region_variant')
    const resCombinedSplice = buildLollipopVariants(combinedSplice, [], 'THOC5')
    expect(resCombinedSplice[0].consequenceCategory).toBe('splice')

    // Canonical splice consequences rank above inframe and missense (#664)
    const spliceDonorInframe = row({
      func: 'splice_donor_variant&inframe_deletion',
      consequence: 'HIGH'
    })
    expect(resolveVariantConsequence(spliceDonorInframe)).toBe('splice_donor_variant')
    const resSpliceDonorInframe = buildLollipopVariants(spliceDonorInframe, [], 'THOC5')
    expect(resSpliceDonorInframe[0].consequenceCategory).toBe('splice')

    const spliceAcceptorMissense = row({
      func: 'splice_acceptor_variant&missense_variant',
      consequence: 'HIGH'
    })
    expect(resolveVariantConsequence(spliceAcceptorMissense)).toBe('splice_acceptor_variant')
    const resSpliceAcceptorMissense = buildLollipopVariants(spliceAcceptorMissense, [], 'THOC5')
    expect(resSpliceAcceptorMissense[0].consequenceCategory).toBe('splice')

    // Unrecognized func falling back to consequence: custom_unknown_term -> HIGH (truncating)
    const unrecognizedFunc = row({
      func: 'custom_unknown_term',
      consequence: 'HIGH'
    })
    expect(resolveVariantConsequence(unrecognizedFunc)).toBe('HIGH')
    const resUnrecognized = buildLollipopVariants(unrecognizedFunc, [], 'THOC5')
    expect(resUnrecognized[0].consequenceCategory).toBe('truncating')
  })
})
