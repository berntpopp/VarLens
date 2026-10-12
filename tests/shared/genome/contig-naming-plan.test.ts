import { describe, expect, it } from 'vitest'

import { GENOME_BUILDS, type GenomeBuildDef } from '../../../src/shared/config/genome-builds.config'
import {
  contigRenamePairs,
  planCaseContigNaming
} from '../../../src/shared/genome/contig-naming-plan'

const [GRCH38, GRCH37] = GENOME_BUILDS as readonly GenomeBuildDef[]
const header = (build: GenomeBuildDef, prefix: '' | 'chr'): string[] => [
  '##fileformat=VCFv4.2',
  ...Object.entries(build.contigs).map(
    ([name, len]) => `##contig=<ID=${prefix}${name},length=${len}>`
  )
]
const contigs = (...chrs: string[]) => chrs.map((chr) => ({ chr, maxPos: 10_000 }))

describe('planCaseContigNaming', () => {
  it('a case already in its build form needs nothing, whatever the evidence', () => {
    expect(
      planCaseContigNaming({
        genomeBuild: 'GRCh38',
        contigs: contigs('chr1', 'chrX', 'chrM', 'chrUn_x'),
        headerLines: header(GRCH37, '')
      })
    ).toEqual({ action: 'none' })
    expect(
      planCaseContigNaming({
        genomeBuild: 'GRCh37',
        contigs: contigs('1', 'MT', 'chrM'),
        headerLines: []
      })
    ).toEqual({ action: 'none' })
  })

  it('renames when the header confirms the stored build', () => {
    expect(
      planCaseContigNaming({
        genomeBuild: 'GRCh38',
        contigs: contigs('1', 'chr2', 'MT', 'GL000192.1'),
        headerLines: header(GRCH38, '')
      })
    ).toEqual({
      action: 'rename',
      pairs: [
        { from: '1', to: 'chr1' },
        { from: 'MT', to: 'chrM' }
      ]
    })
  })

  it('a header tag confirming the build is enough', () => {
    expect(
      planCaseContigNaming({
        genomeBuild: 'GRCh37',
        contigs: contigs('chr1'),
        headerLines: ['##reference=file:///ref/hs37d5.fa']
      })
    ).toMatchObject({ action: 'rename', pairs: [{ from: 'chr1', to: '1' }] })
  })

  it('flags, with the detected build, when the header says another build', () => {
    expect(
      planCaseContigNaming({
        genomeBuild: 'GRCh38',
        contigs: contigs('1'),
        headerLines: header(GRCH37, '')
      })
    ).toEqual({ action: 'flag', suggestedBuild: 'GRCh37', reason: 'build_disagrees' })
  })

  it('flags when a stored position is beyond the stored build', () => {
    expect(
      planCaseContigNaming({
        genomeBuild: 'GRCh38',
        contigs: [{ chr: '1', maxPos: 249_000_000 }],
        headerLines: []
      })
    ).toEqual({ action: 'flag', suggestedBuild: null, reason: 'build_excluded' })
  })

  it('never guesses: no evidence flags the case', () => {
    expect(
      planCaseContigNaming({ genomeBuild: 'GRCh38', contigs: contigs('1', '2'), headerLines: [] })
    ).toEqual({ action: 'flag', suggestedBuild: null, reason: 'no_evidence' })
  })
})

describe('contigRenamePairs', () => {
  it('lists only the names that change, for the chosen build', () => {
    expect(contigRenamePairs(['1', 'chr2', 'chrM', 'KI270706.1'], 'GRCh37')).toEqual([
      { from: 'chr2', to: '2' }
    ])
  })
})
