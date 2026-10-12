import { describe, expect, it } from 'vitest'
import { freezeSpikes } from '../../../../scripts/shortlist-sim/annotate/freeze'
import type { LocalVepRecord } from '../../../../scripts/shortlist-sim/annotate/local-vep'
import type { NormalizedAllele } from '../../../../scripts/shortlist-sim/annotate/normalize'

const allele = (key: string): NormalizedAllele => {
  const [chr, pos, ref, alt] = key.split(':')
  return { input: key, chr, pos: Number(pos), ref, alt, key, status: 'ok' }
}
const local = (key: string): LocalVepRecord => ({
  key,
  mostSevere: 'missense_variant',
  impact: 'MODERATE',
  terms: ['missense_variant'],
  transcript: 'ENST1',
  isMane: true,
  gene: 'G',
  caddPhred: 25,
  gnomadJointAf: null,
  gnomadExomeAf: 1e-5,
  gnomadGenomeAf: null,
  popmaxAf: null,
  exomePopmaxAf: 2e-5,
  genomePopmaxAf: null,
  inGnomadCache: true
})
describe('freezeSpikes', () => {
  it('takes every spike field from the local VEP run and records provenance', () => {
    const out = freezeSpikes(
      [
        allele('1:20:C:T'),
        allele('1:10:A:G'),
        { ...allele('1:30:A:C'), status: 'ref_mismatch' },
        allele('1:40:G:A')
      ],
      new Map([
        ['1:10:A:G', local('1:10:A:G')],
        ['1:20:C:T', local('1:20:C:T')]
      ])
    )
    expect(out.map((a) => a.key)).toEqual(['1:10:A:G', '1:20:C:T', '1:40:G:A'])
    expect(out[0]).toMatchObject({ vepSource: 'local-vep', gnomadSource: 'local-vep', errors: [] })
    expect(out[0].vep).toMatchObject({ caddPhred: 25, isMane: true, hgvsc: null })
    expect(out[0].gnomad).toMatchObject({ found: true, exomeAf: 1e-5, exomePopmaxAf: 2e-5 })
    expect(out[2]).toMatchObject({ vep: null, vepSource: 'none', errors: ['local-vep: no record'] })
  })
})
