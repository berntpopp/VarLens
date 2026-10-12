import { describe, expect, it } from 'vitest'
import { freezeSpikes } from '../../../../scripts/shortlist-sim/annotate/freeze'
import type { LocalVepRecord } from '../../../../scripts/shortlist-sim/annotate/local-vep'
import type { NormalizedAllele } from '../../../../scripts/shortlist-sim/annotate/normalize'
import type { SpikeAnnotation } from '../../../../scripts/shortlist-sim/annotate/spike-annotation'

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
const gnomad = {
  found: true,
  exomeAf: 3e-5,
  genomeAf: null,
  jointAf: 3e-5,
  popmaxAf: 1e-4,
  exomePopmaxAf: 1e-4,
  genomePopmaxAf: null,
  dataset: 'gnomad_r4'
}

describe('freezeSpikes', () => {
  it('keeps genefoundry parts, falls back to local VEP per field and records provenance', () => {
    const gf: SpikeAnnotation = {
      key: '1:10:A:G',
      poolKey: '1:10:A:G',
      vep: null,
      gnomad,
      fetchedAt: 't',
      errors: ['vep: down']
    }
    const out = freezeSpikes(
      [allele('1:10:A:G'), allele('1:20:C:T'), { ...allele('1:30:A:C'), status: 'ref_mismatch' }],
      new Map([[gf.key, gf]]),
      new Map([
        ['1:10:A:G', local('1:10:A:G')],
        ['1:20:C:T', local('1:20:C:T')]
      ])
    )
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({
      vepSource: 'local-vep',
      gnomadSource: 'genefoundry',
      errors: []
    })
    expect(out[0].gnomad?.exomeAf).toBe(3e-5)
    expect(out[0].vep?.caddPhred).toBe(25)
    expect(out[1]).toMatchObject({ vepSource: 'local-vep', gnomadSource: 'local-vep' })
    expect(out[1].gnomad).toMatchObject({ found: true, exomeAf: 1e-5, exomePopmaxAf: 2e-5 })
  })
})
