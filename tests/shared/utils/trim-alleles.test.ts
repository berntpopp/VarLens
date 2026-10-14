import { describe, expect, it } from 'vitest'

import { trimAlleles } from '../../../src/shared/utils/trim-alleles'

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
