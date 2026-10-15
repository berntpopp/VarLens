import { describe, expect, it } from 'vitest'

import {
  leftAlignAlleles,
  trimAlleles,
  type ReferenceWindowLookup
} from '../../../src/shared/utils/trim-alleles'

function windowFrom(sequence: string, offset1Based = 1): ReferenceWindowLookup {
  const fullSeq = 'G'.repeat(Math.max(0, offset1Based - 1)) + sequence
  return (start1Based: number, end1BasedInclusive: number): string | null => {
    if (
      start1Based < 1 ||
      end1BasedInclusive < start1Based ||
      end1BasedInclusive > fullSeq.length
    ) {
      return null
    }
    return fullSeq.slice(start1Based - 1, end1BasedInclusive)
  }
}

describe('trimAlleles (#587)', () => {
  it.each([
    // [pos, ref, alt] → [pos, ref, alt]
    [
      [100, 'A', 'G'],
      [100, 'A', 'G']
    ], // SNV untouched
    [
      [100, 'AT', 'A'],
      [100, 'AT', 'A']
    ], // minimal deletion untouched
    [
      [100, 'A', 'AT'],
      [100, 'A', 'AT']
    ], // minimal insertion untouched
    [
      [100, 'ATT', 'AT'],
      [100, 'AT', 'A']
    ], // multi-allelic split leftover (ATT>A,AT)
    [
      [100, 'ATT', 'ATTT'],
      [100, 'A', 'AT']
    ], // insertion with shared suffix
    [
      [100, 'ACG', 'ATG'],
      [101, 'C', 'T']
    ], // padded SNV: suffix then prefix
    [
      [100, 'GACT', 'GTCT'],
      [101, 'A', 'T']
    ],
    [
      [100, 'CAGT', 'CTGA'],
      [101, 'AGT', 'TGA']
    ], // MNV keeps its inner bases
    [
      [100, 'GCAT', 'GCT'],
      [101, 'CA', 'C']
    ], // prefix trim keeps one anchor base
    [
      [100, 'AA', 'AA'],
      [100, 'A', 'A']
    ] // REF == ALT keeps one base
  ] as const)('%j → %j', ([pos, ref, alt], [ePos, eRef, eAlt]) => {
    expect(trimAlleles(pos, ref, alt)).toEqual({ pos: ePos, ref: eRef, alt: eAlt })
  })

  it.each(['<DEL>', '<DUP:TANDEM>', 'AT[chr2:3000[', ']chr2:3000]TA', '*', '.'])(
    'leaves symbolic ALT %s untouched',
    (alt) => {
      expect(trimAlleles(100, 'AT', alt)).toEqual({ pos: 100, ref: 'AT', alt })
    }
  )

  it('compares exactly, so case differences are not trimmed', () => {
    expect(trimAlleles(100, 'ATT', 'Att')).toEqual({ pos: 101, ref: 'TT', alt: 'tt' })
  })

  it('gives both spellings of one deletion the same identity', () => {
    expect(trimAlleles(100, 'ATT', 'AT')).toEqual(trimAlleles(100, 'AT', 'A'))
  })
})

describe('leftAlignAlleles (#587)', () => {
  it('collapses homopolymer deletions and insertions to one left-aligned identity', () => {
    // 100..104 = C A A A T
    const fetchWindow = windowFrom('CAAAT', 100)

    expect(leftAlignAlleles(100, 'CA', 'C', fetchWindow)).toEqual({
      pos: 100,
      ref: 'CA',
      alt: 'C'
    })
    expect(leftAlignAlleles(101, 'AA', 'A', fetchWindow)).toEqual({
      pos: 100,
      ref: 'CA',
      alt: 'C'
    })
    expect(leftAlignAlleles(102, 'AA', 'A', fetchWindow)).toEqual({
      pos: 100,
      ref: 'CA',
      alt: 'C'
    })

    // Homopolymer insertion of A at any position in the run collapses to 100:C:CA
    expect(leftAlignAlleles(100, 'C', 'CA', fetchWindow)).toEqual({
      pos: 100,
      ref: 'C',
      alt: 'CA'
    })
    expect(leftAlignAlleles(101, 'A', 'AA', fetchWindow)).toEqual({
      pos: 100,
      ref: 'C',
      alt: 'CA'
    })
    expect(leftAlignAlleles(103, 'A', 'AA', fetchWindow)).toEqual({
      pos: 100,
      ref: 'C',
      alt: 'CA'
    })
  })

  it('left-aligns dinucleotide and trinucleotide tandem repeat indels to the repeat anchor', () => {
    // 100..108 = G C A C A C A G T
    const diWindow = windowFrom('GCACACAGT', 100)
    expect(leftAlignAlleles(104, 'ACA', 'A', diWindow)).toEqual({
      pos: 100,
      ref: 'GCA',
      alt: 'G'
    })
    expect(leftAlignAlleles(101, 'CACACA', 'CACA', diWindow)).toEqual({
      pos: 100,
      ref: 'GCA',
      alt: 'G'
    })

    // 100..110 = T C A G C A G C A G A
    const triWindow = windowFrom('TCAGCAGCAGA', 100)
    expect(leftAlignAlleles(106, 'GCAG', 'G', triWindow)).toEqual({
      pos: 100,
      ref: 'TCAG',
      alt: 'T'
    })
  })

  it('combines suffix/prefix trimming with left-alignment', () => {
    const fetchWindow = windowFrom('GCACACAGT', 100)
    expect(leftAlignAlleles(101, 'CACACAG', 'CACAG', fetchWindow)).toEqual({
      pos: 100,
      ref: 'GCA',
      alt: 'G'
    })
  })

  it('falls back to trimAlleles when fetchWindow is omitted, returns null, hits pos=1, or encounters N', () => {
    expect(leftAlignAlleles(102, 'AA', 'A')).toEqual({ pos: 102, ref: 'AA', alt: 'A' })
    expect(leftAlignAlleles(102, 'AA', 'A', null)).toEqual({ pos: 102, ref: 'AA', alt: 'A' })
    expect(leftAlignAlleles(102, 'AA', 'A', () => null)).toEqual({
      pos: 102,
      ref: 'AA',
      alt: 'A'
    })

    // Contig start (pos = 1): cannot shift left past position 1
    const startWindow = windowFrom('CAAAT', 1)
    expect(leftAlignAlleles(1, 'CA', 'C', startWindow)).toEqual({
      pos: 1,
      ref: 'CA',
      alt: 'C'
    })
    expect(leftAlignAlleles(3, 'AA', 'A', startWindow)).toEqual({
      pos: 1,
      ref: 'CA',
      alt: 'C'
    })

    // Ambiguous N base falls back to trimAlleles
    const nWindow = windowFrom('CNAAAT', 99)
    expect(leftAlignAlleles(102, 'AA', 'A', nWindow)).toEqual({
      pos: 102,
      ref: 'AA',
      alt: 'A'
    })
  })
})
