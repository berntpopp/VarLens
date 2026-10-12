import { describe, expect, it } from 'vitest'

import { GENOME_BUILDS } from '../../../src/shared/config/genome-builds.config'
import { chromosomeRank } from '../../../src/shared/sql/chromosome-order'
import {
  bareContig,
  canonicalContig,
  contigQueryNames,
  intervalsForAllSpellings,
  isCanonicalContig
} from '../../../src/shared/utils/contig'

const PRIMARY = [...Array.from({ length: 22 }, (_, i) => String(i + 1)), 'X', 'Y']
const spellings = (n: string): string[] => [
  n,
  `chr${n}`,
  `Chr${n}`,
  `CHR${n.toLowerCase()}`,
  ` ${n} `
]

describe('canonicalContig', () => {
  describe.each(GENOME_BUILDS.map((b) => [b.id, b] as const))('%s', (id, build) => {
    it.each(PRIMARY)('every spelling of %s gives the reference form', (n) => {
      for (const s of spellings(n)) {
        expect(canonicalContig(s, id)).toBe(`${build.naming.primaryPrefix}${n}`)
      }
    })

    it('renaming never changes the chromosome rank', () => {
      for (const n of PRIMARY) {
        for (const s of spellings(n)) {
          expect(chromosomeRank(canonicalContig(s, id))).toBe(chromosomeRank(s.trim()))
        }
      }
    })
  })

  it.each([
    ['GRCh38', 'M', 'chrM'],
    ['GRCh38', 'MT', 'chrM'],
    ['GRCh38', 'chrM', 'chrM'],
    ['GRCh38', 'chrMT', 'chrM'],
    ['GRCh38', 'mt', 'chrM'],
    ['GRCh37', 'MT', 'MT'],
    ['GRCh37', 'chrMT', 'MT'],
    ['GRCh37', 'mt', 'MT'],
    // hg19 chrM is NC_001807, not rCRS: never merged with GRCh37 MT
    ['GRCh37', 'chrM', 'chrM'],
    ['GRCh37', 'M', 'M']
  ])('mitochondrion %s %s → %s', (build, input, expected) => {
    expect(canonicalContig(input, build)).toBe(expected)
  })

  it.each(['GRCh38', 'GRCh37'])('alt, decoy, unplaced and RefSeq names stay verbatim (%s)', (b) => {
    for (const c of [
      'chr1_KI270706v1_random',
      'chrUn_GL000220v1',
      'chr6_GL000250v2_alt',
      'chrEBV',
      'HLA-A*01:01:01:01',
      'GL000192.1',
      'KI270706.1',
      'NC_000001.11',
      'hs37d5'
    ]) {
      expect(canonicalContig(c, b)).toBe(c)
    }
  })

  it('an unknown build keeps every name', () => {
    expect(canonicalContig('1', 'hg17')).toBe('1')
    expect(canonicalContig('chr1', '')).toBe('chr1')
  })

  it('isCanonicalContig is true exactly when nothing would be renamed', () => {
    expect(isCanonicalContig('chr1', 'GRCh38')).toBe(true)
    expect(isCanonicalContig('1', 'GRCh38')).toBe(false)
    expect(isCanonicalContig('chrM', 'GRCh37')).toBe(true)
    expect(isCanonicalContig('chrUn_x', 'GRCh37')).toBe(true)
  })
})

describe('bareContig', () => {
  it.each([
    ['chr1', '1'],
    ['1', '1'],
    ['chrx', 'X'],
    ['chrM', 'MT'],
    ['M', 'MT'],
    ['mt', 'MT'],
    ['chrUn_GL000220v1', 'Un_GL000220v1'],
    ['GL000192.1', 'GL000192.1']
  ])('%s → %s', (input, expected) => {
    expect(bareContig(input)).toBe(expected)
  })
})

describe('contigQueryNames', () => {
  it('covers the reference form of every importable build', () => {
    expect(contigQueryNames('1').sort()).toEqual(['1', 'chr1'])
    expect(contigQueryNames('chr7').sort()).toEqual(['7', 'chr7'])
    expect(contigQueryNames('x').sort()).toEqual(['X', 'chrX'])
  })

  it('a mitochondrion matches every stored mito name, the hg19 chrM included', () => {
    for (const input of ['M', 'MT', 'chrM', 'chrMT']) {
      expect(contigQueryNames(input)).toEqual(expect.arrayContaining(['chrM', 'MT']))
    }
  })

  it('other contigs only match themselves', () => {
    expect(contigQueryNames('chrUn_GL000220v1')).toEqual(['chrUn_GL000220v1'])
  })
})

describe('intervalsForAllSpellings', () => {
  it('repeats each region once per stored spelling of its contig, other fields kept', () => {
    expect(intervalsForAllSpellings([{ chr: 'chr7', start: 1, end: 2 }])).toEqual([
      { chr: 'chr7', start: 1, end: 2 },
      { chr: '7', start: 1, end: 2 }
    ])
    expect(intervalsForAllSpellings([{ chr: 'chrUn_x', start: 1, end: 2 }])).toEqual([
      { chr: 'chrUn_x', start: 1, end: 2 }
    ])
  })
})
