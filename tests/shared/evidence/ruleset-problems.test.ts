import { afterEach, describe, it, expect } from 'vitest'
import {
  describeProblem,
  evidenceConfigProblems,
  isReferenceRule,
  problemKey,
  rulesetProblems
} from '../../../src/shared/evidence/ruleset-problems'
import { SHORTLIST_EVIDENCE_CONFIG } from '../../../src/shared/config/shortlist-evidence.config'
import { VARVIS_EVIDENCE_TEMPLATE } from '../../../src/shared/config/evidence-rulesets/varvis-template'
import type { EvidenceRuleset } from '../../../src/shared/types/evidence-ruleset'
import type { ShortlistConfig } from '../../../src/shared/types/shortlist'

const clone = (): EvidenceRuleset => structuredClone(VARVIS_EVIDENCE_TEMPLATE)
const keys = (rs: unknown): string[] => rulesetProblems(rs).map((p) => problemKey(p.path))

describe('rulesetProblems', () => {
  it('accepts the varvis template', () => {
    expect(rulesetProblems(VARVIS_EVIDENCE_TEMPLATE)).toEqual([])
  })

  it('places a bad condition at its field with the parser position', () => {
    const rs = clone()
    rs.groups[1].rules[0].when = 'cadd:>:20 AND nope:=:1'
    const [problem] = rulesetProblems(rs)
    expect(problemKey(problem.path)).toBe('groups.1.rules.0.when')
    expect(problem.position).toBeGreaterThan(0)
  })

  it('reports schema, structure and condition problems together', () => {
    const rs = clone()
    rs.groups[0].rules[0].points = 1.25 // off-step
    rs.groups[0].rules[1].id = rs.groups[0].rules[0].id // duplicate
    rs.groups[2].rules[0].when = 'cadd:>:' // does not compile
    expect(keys(rs)).toEqual(
      expect.arrayContaining([
        'groups.0.rules.0.points',
        'groups.0.rules.1.id',
        'groups.2.rules.0.when'
      ])
    )
  })

  it('pins the reference rule last', () => {
    const rs = clone()
    const freq = rs.groups[0].rules
    freq.unshift(freq.pop()!)
    expect(keys(rs)).toEqual(expect.arrayContaining(['groups.0.rules.0']))
    expect(isReferenceRule(freq[0])).toBe(true)
  })

  // Tuned rulesets anchor points at the best-supported bin (spec §14–15), so
  // the catch-all reference rule carries its own estimate.
  it('lets the reference rule carry points', () => {
    const rs = clone()
    const freq = rs.groups[0].rules
    freq[freq.length - 1].points = -1.5
    expect(keys(rs)).not.toContain(`groups.0.rules.${freq.length - 1}.points`)
  })

  it('does not double-report a condition that already fails the schema', () => {
    const rs = clone()
    rs.groups[0].rules[0].when = ''
    expect(keys(rs).filter((k) => k === 'groups.0.rules.0.when')).toHaveLength(1)
  })

  it('stops at schema issues for a value it cannot walk', () => {
    expect(rulesetProblems({ version: 1, id: 'x', modes: 'nope' }).length).toBeGreaterThan(0)
  })
})

describe('evidenceConfigProblems / describeProblem', () => {
  const config = (ruleset: EvidenceRuleset): ShortlistConfig => ({
    variantTypeScope: ['snv', 'sv'],
    topN: 10,
    baseFilters: {},
    rankConfig: {
      weights: { impact: 0, pathogenicity: 0, rarity: 0, clinvar: 0, phenotype: 0 },
      ruleset
    }
  })

  it('prefixes ruleset paths and names the rule by id', () => {
    const rs = clone()
    rs.groups[0].rules[0].when = 'nope:=:1'
    const problems = evidenceConfigProblems(config(rs))
    expect(problems.map((p) => problemKey(p.path))).toEqual([
      'variantTypeScope',
      'rankConfig.ruleset.groups.0.rules.0.when'
    ])
    expect(describeProblem(problems[1], rs)).toMatch(/^rule af_missing: /)
  })
})

// #581, #582, #642: CNV and STR are enabled by default; SV stays behind its flag.
describe('variant-type scoped groups', () => {
  const flags = SHORTLIST_EVIDENCE_CONFIG.structuralTypes.enabled
  afterEach(() => {
    flags.sv = false
    flags.cnv = flags.str = true
  })
  const svRuleset = (): EvidenceRuleset => {
    const rs = clone()
    rs.groups.push({
      id: 'sv_size',
      label: 'SV size',
      scope: 'global',
      variantType: 'sv',
      rules: [
        { id: 'sv_big', label: 'large', when: 'sv_length:>=:100000 AND sv_type:=:DEL', points: 1 }
      ]
    })
    return rs
  }
  const svConfig = (ruleset: EvidenceRuleset): ShortlistConfig => ({
    variantTypeScope: ['snv', 'indel', 'sv', 'cnv'],
    topN: 10,
    baseFilters: {},
    rankConfig: {
      weights: { impact: 0, pathogenicity: 0, rarity: 0, clinvar: 0, phenotype: 0 },
      ruleset
    }
  })

  it('accepts CNV and STR by default while rejecting SV', () => {
    expect(flags).toEqual({ sv: false, cnv: true, str: true })
    expect(keys(svRuleset())).toEqual([
      'groups.' + VARVIS_EVIDENCE_TEMPLATE.groups.length + '.variantType'
    ])
    expect(evidenceConfigProblems(svConfig(svRuleset())).map((p) => problemKey(p.path))).toEqual([
      'variantTypeScope',
      `rankConfig.ruleset.groups.${VARVIS_EVIDENCE_TEMPLATE.groups.length}.variantType`
    ])
    const cnvStr = svRuleset()
    cnvStr.groups[cnvStr.groups.length - 1].variantType = 'cnv'
    expect(rulesetProblems(cnvStr)).toEqual([])
    cnvStr.groups[cnvStr.groups.length - 1].variantType = 'str'
    expect(rulesetProblems(cnvStr)).toEqual([])
    expect(
      evidenceConfigProblems({
        ...svConfig(cnvStr),
        variantTypeScope: ['snv', 'indel', 'cnv', 'str']
      })
    ).toEqual([])
  })

  it('accepts SV when its flag is turned on', () => {
    flags.sv = true
    expect(rulesetProblems(svRuleset())).toEqual([])
    expect(evidenceConfigProblems(svConfig(svRuleset()))).toEqual([])
  })

  it('gates each structural type independently when toggled off', () => {
    flags.str = false
    const rs = svRuleset()
    rs.groups[rs.groups.length - 1].variantType = 'str'
    expect(rulesetProblems(rs).map((p) => problemKey(p.path))).toEqual([
      `groups.${rs.groups.length - 1}.variantType`
    ])
    const config = {
      ...svConfig(clone()),
      variantTypeScope: ['snv', 'str'] as ShortlistConfig['variantTypeScope']
    }
    expect(evidenceConfigProblems(config).map((p) => problemKey(p.path))).toEqual([
      'variantTypeScope'
    ])
  })

  it('accepts points up to +24 (#640)', () => {
    const rs = clone()
    rs.groups[0].rules[0].points = 24
    expect(rulesetProblems(rs)).toEqual([])
    rs.groups[0].rules[0].points = 24.5
    expect(keys(rs)).toContain('groups.0.rules.0.points')
  })
})
