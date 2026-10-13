import { describe, it, expect } from 'vitest'
import { compileRuleset } from '../../../../../src/main/services/scoring/evidence/ruleset'
import { scoreEvidenceRow } from '../../../../../src/main/services/scoring/evidence/score'
import type { DerivedFields } from '../../../../../src/main/services/scoring/evidence/case-context'
import type { EvidenceRuleset } from '../../../../../src/shared/types/evidence-ruleset'

const RS: EvidenceRuleset = {
  version: 1,
  id: 'test',
  modes: [
    { id: 'ar_hom', label: 'AR hom', when: 'moi:~:AR AND zygosity:=:hom', points: 3 },
    {
      id: 'ar_comphet',
      label: 'AR comphet',
      when: 'moi:~:AR AND zygosity:=:het AND gene_het_hits:>=:2',
      points: 2
    },
    { id: 'ad', label: 'AD', when: 'moi:~:AD AND zygosity:=:het', points: 1 },
    { id: 'fallback', label: 'No compatible mode', when: null, points: -1 }
  ],
  groups: [
    {
      id: 'freq',
      label: 'Frequency',
      scope: 'global',
      rules: [
        { id: 'af_missing', label: 'not in gnomAD', when: 'gnomad_af:is:null', points: 3 },
        { id: 'af_1e5', label: 'AF < 1e-5', when: 'gnomad_af:<:0.00001', points: 4 },
        { id: 'af_1e3', label: 'AF < 1e-3', when: 'gnomad_af:<:0.001', points: 2 }
      ]
    },
    {
      id: 'lof',
      label: 'Effect',
      scope: 'global',
      rules: [
        {
          id: 'lof',
          label: 'LoF',
          when: 'func:=:stop_gained OR func:=:frameshift_truncation',
          points: 5
        }
      ]
    },
    {
      id: 'ad_freq',
      label: 'AD frequency',
      scope: 'ad',
      rules: [
        { id: 'ad_common', label: 'too common for AD', when: 'gnomad_af:>:0.0001', points: -3 }
      ]
    }
  ]
}

const d = (o: Partial<DerivedFields>): DerivedFields => ({
  zygosity: 'het',
  gene_het_hits: 1,
  gene_hits: 1,
  partners: [],
  ...o
})
const sum = (s: { contributions: Array<{ points: number }> }): number =>
  s.contributions.reduce((a, x) => a + x.points, 0)

describe('scoreEvidenceRow', () => {
  const c = compileRuleset(RS)

  it('decision list: first matching rule of a group wins', () => {
    const s = scoreEvidenceRow(
      { gnomad_af: 0.000001, func: 'stop_gained', moi: 'AR' },
      d({ zygosity: 'hom' }),
      c
    )
    expect(s.mode).toBe('ar_hom')
    expect(s.score).toBe(3 + 4 + 5)
    expect(sum(s)).toBe(s.score)
  })

  it('modes are a decision list: a matching mode keeps its penalty, fallback is not eligible', () => {
    // AD matches: 1 + 2 + 5 - 3 = 5 (fallback would give 6, but it only applies when nothing matches)
    const s = scoreEvidenceRow({ gnomad_af: 0.0005, func: 'stop_gained', moi: 'AD' }, d({}), c)
    expect(s.mode).toBe('ad')
    expect(s.score).toBe(5)
    expect(s.contributions.map((x) => x.id)).toEqual(['ad', 'af_1e3', 'lof', 'ad_common'])
    expect(sum(s)).toBe(s.score)
  })

  it('the earlier mode wins when several match (ar_comphet before ad)', () => {
    const s = scoreEvidenceRow(
      { gnomad_af: 0.0005, func: 'stop_gained', moi: 'AD, AR' },
      d({ gene_het_hits: 2, partners: [9] }),
      c
    )
    expect(s.mode).toBe('ar_comphet')
    expect(s.score).toBe(2 + 2 + 5)
  })

  it('compound het needs two het alleles', () => {
    expect(
      scoreEvidenceRow({ moi: 'AR', func: 'stop_gained' }, d({ gene_het_hits: 1 }), c).mode
    ).toBe('fallback')
    expect(
      scoreEvidenceRow({ moi: 'AR', func: 'stop_gained' }, d({ gene_het_hits: 2 }), c).mode
    ).toBe('ar_comphet')
  })

  it('missing fields never contribute (Review Focus 1)', () => {
    const s = scoreEvidenceRow({ gnomad_af: 0, func: null, moi: null }, d({}), c)
    expect(s.contributions.map((x) => x.id)).toEqual(['fallback', 'af_1e5'])
    expect(s.score).toBe(-1 + 4)
  })

  it('odd imported values score without throwing and land in fallback (Review Focus 5)', () => {
    const s = scoreEvidenceRow({ hpo_sim_score: [], func: ['stop_gained'], moi: null }, d({}), c)
    expect(s.mode).toBe('fallback')
    expect(s.contributions.map((x) => x.id)).toEqual(['fallback', 'af_missing'])
  })

  it('derived fields override same-named row keys', () => {
    const s = scoreEvidenceRow({ moi: 'AR', zygosity: 'het' }, d({ zygosity: 'hom' }), c)
    expect(s.mode).toBe('ar_hom')
  })
})
