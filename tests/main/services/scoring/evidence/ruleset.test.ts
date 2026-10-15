import { describe, it, expect } from 'vitest'
import {
  compileRuleset,
  validateEvidenceConfig,
  EvidenceRulesetError
} from '../../../../../src/main/services/scoring/evidence/ruleset'
import type { EvidenceRuleset } from '../../../../../src/shared/types/evidence-ruleset'
import type { ShortlistConfig } from '../../../../../src/shared/types/shortlist'

const base: EvidenceRuleset = {
  version: 1,
  id: 'x',
  modes: [{ id: 'fallback', label: 'f', when: null, points: 0 }],
  groups: []
}
const rule = (id: string, points: number, when = 'cadd:>=:1') => ({ id, label: id, when, points })
const group = (rules: ReturnType<typeof rule>[], scope: 'global' | 'ad' = 'global') => ({
  id: 'g',
  label: 'g',
  scope,
  rules
})

describe('compileRuleset', () => {
  it('records whether any mode or rule reads hpo_resnik', () => {
    expect(compileRuleset(base).usesHpoResnik).toBe(false)
    expect(
      compileRuleset({ ...base, groups: [group([rule('a', 1, 'gene_symbol:=:hpo_resnik')])] })
        .usesHpoResnik
    ).toBe(false)
    expect(
      compileRuleset({ ...base, groups: [group([rule('a', 1, 'cadd:>:1 OR hpo_resnik:>=:2')])] })
        .usesHpoResnik
    ).toBe(true)
    const modes = [
      { id: 'ad' as const, label: 'ad', when: 'hpo_resnik:>:1', points: 1 },
      ...base.modes
    ]
    expect(compileRuleset({ ...base, modes }).usesHpoResnik).toBe(true)
    for (const when of ['hpo_conflicts:>=:1', 'hpo_best_disease:~:OMIM']) {
      expect(compileRuleset({ ...base, groups: [group([rule('a', 1, when)])] }).usesHpoResnik).toBe(
        true
      )
    }
  })

  it('accepts a minimal ruleset and a group mixing bonus and penalty bins', () => {
    expect(() => compileRuleset(base)).not.toThrow()
    expect(() =>
      compileRuleset({ ...base, groups: [group([rule('a', 2), rule('b', -1.5), rule('c', 0)])] })
    ).not.toThrow()
  })

  it('rejects bad DSL with the rule id in the message', () => {
    expect(() =>
      compileRuleset({ ...base, groups: [group([rule('bad', 1, 'nope:=:1')])] })
    ).toThrow(/bad/)
    expect(() =>
      compileRuleset({ ...base, groups: [group([rule('partial', 1, 'cadd:>:20 AND')])] })
    ).toThrow(EvidenceRulesetError)
  })

  it('rejects structural problems', () => {
    const bad: EvidenceRuleset[] = [
      { ...base, groups: [group([rule('a', 1), rule('a', 2)])] }, // duplicate rule id
      { ...base, modes: [] }, // no fallback
      { ...base, modes: [{ id: 'fallback', label: 'f', when: 'cadd:>:1', points: 0 }] }, // fallback with when
      { ...base, modes: [{ id: 'ad', label: 'ad', when: null, points: 0 }, ...base.modes] }, // mode without when
      {
        ...base,
        modes: [
          { id: 'ad', label: 'ad', when: 'zygosity:=:het', points: 0 },
          { id: 'ad', label: 'ad2', when: 'zygosity:=:het', points: 0 },
          ...base.modes
        ]
      }, // duplicate mode
      {
        ...base,
        modes: [
          { id: 'ad', label: 'ad', when: 'zygosity:=:het', points: 0 },
          { id: 'ar_hom', label: 'ar', when: 'zygosity:=:hom', points: 0 },
          ...base.modes
        ]
      }, // out of the fixed mode order
      {
        ...base,
        modes: [...base.modes, { id: 'ad', label: 'ad', when: 'zygosity:=:het', points: 0 }]
      }, // fallback not last
      { ...base, groups: [group([rule('a', 25)])] }, // |points| > 24
      { ...base, groups: [group([rule('a', 1.25)])] }, // not a 0.5 step
      { ...base, groups: [group([rule('a', 1)], 'ad')] }, // scope names an absent mode
      { ...base, groups: [group([rule('a', 1, 'qual:>:30 AND @preset')])] }
    ]
    for (const rs of bad)
      expect(() => compileRuleset(rs), JSON.stringify(rs)).toThrow(EvidenceRulesetError)
  })

  it('caps the total number of rules at 200', () => {
    const groups = Array.from({ length: 11 }, (_, g) => ({
      id: `g${g}`,
      label: 'g',
      scope: 'global' as const,
      rules: Array.from({ length: 20 }, (_, r) => rule(`r${g}_${r}`, 1))
    }))
    expect(() => compileRuleset({ ...base, groups })).toThrow(/200/)
  })
})

describe('validateEvidenceConfig', () => {
  const cfg = (o: Partial<ShortlistConfig>): ShortlistConfig => ({
    topN: 50,
    baseFilters: {},
    rankConfig: {
      weights: { impact: 0, pathogenicity: 0, rarity: 0, clinvar: 0, phenotype: 0 },
      ruleset: base
    },
    ...o
  })

  it('accepts snv/indel scope without inheritance filters', () => {
    expect(validateEvidenceConfig(cfg({ variantTypeScope: ['snv', 'indel'] }))).toEqual([])
    expect(
      validateEvidenceConfig(
        cfg({ variantTypeScope: ['snv'], baseFilters: { inheritanceModes: [] } })
      )
    ).toEqual([])
  })

  it('rejects sv scope, missing scope, inheritance modes, analysis group', () => {
    expect(validateEvidenceConfig(cfg({ variantTypeScope: ['snv', 'sv'] }))).not.toEqual([])
    expect(validateEvidenceConfig(cfg({}))).not.toEqual([])
    expect(validateEvidenceConfig(cfg({ variantTypeScope: [] }))).not.toEqual([])
    expect(
      validateEvidenceConfig(
        cfg({ variantTypeScope: ['snv'], baseFilters: { inheritanceModes: ['homozygous'] } })
      )
    ).not.toEqual([])
    expect(
      validateEvidenceConfig(
        cfg({ variantTypeScope: ['snv'], baseFilters: { analysisGroupId: 3 } })
      )
    ).not.toEqual([])
  })

  it('checks every merged per-type filter, not only baseFilters', () => {
    expect(
      validateEvidenceConfig(
        cfg({
          variantTypeScope: ['snv', 'indel'],
          perTypeOverrides: { indel: { inheritanceModes: ['homozygous'] } }
        })
      )
    ).not.toEqual([])
    expect(
      validateEvidenceConfig(
        cfg({ variantTypeScope: ['snv'], perTypeOverrides: { snv: { analysisGroupId: 2 } } })
      )
    ).not.toEqual([])
    // an override can clear a base value for its type, but another type still inherits it
    expect(
      validateEvidenceConfig(
        cfg({
          variantTypeScope: ['snv', 'indel'],
          baseFilters: { inheritanceModes: ['homozygous'] },
          perTypeOverrides: { snv: { inheritanceModes: [] } }
        })
      )
    ).not.toEqual([])
    // an override for a type outside the scope never runs
    expect(
      validateEvidenceConfig(
        cfg({ variantTypeScope: ['snv'], perTypeOverrides: { sv: { analysisGroupId: 2 } } })
      )
    ).toEqual([])
  })

  it('rejects an invalid ruleset in the config', () => {
    const broken = cfg({ variantTypeScope: ['snv'] })
    broken.rankConfig.ruleset = { ...base, modes: [] }
    expect(validateEvidenceConfig(broken)).not.toEqual([])
  })
})
