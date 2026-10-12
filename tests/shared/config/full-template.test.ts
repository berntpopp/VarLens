import { describe, it, expect } from 'vitest'
import { FULL_EVIDENCE_TEMPLATE } from '../../../src/shared/config/evidence-rulesets/full-template'
import { compileRule } from '../../../src/shared/dsl/evaluate'
import { EvidenceRulesetSchema } from '../../../src/shared/types/evidence-ruleset-schemas'
import { compileRuleset } from '../../../src/main/services/scoring/evidence/ruleset'
import { isReferenceRule, rulesetProblems } from '../../../src/shared/evidence/ruleset-problems'

const pick = <T>(xs: readonly T[], i: number): T => xs[i % xs.length]
const AF = [null, 0, 0.000005, 0.00001, 0.0001, 0.0005, 0.001, 0.01]
const CADD = [null, 0, 15, 20, 25, 30, 45]
const HPO = [null, 0, 0.01, 0.05, 0.1, 0.15]
const FUNC = [null, 'stop_gained', 'missense_variant', 'inframe_indel', 'mnv', 'synonymous_variant']
const CLINVAR = [null, 'Pathogenic', 'Likely_pathogenic', 'Likely_benign', 'Uncertain_significance']
const REVSTAT = [
  null,
  'criteria provided, single submitter',
  'criteria provided, multiple submitters, no conflicts',
  'reviewed by expert panel',
  'practice guideline',
  'no assertion criteria provided',
  'criteria provided, conflicting classifications'
]
const NUM = [null, 0, 0.1, 0.2, 0.25, 0.35, 0.5, 0.6, 0.75, 0.9, 1]
const HOM = [null, 0, 1, 12]

function rows(): Array<Record<string, unknown>> {
  return Array.from({ length: 2000 }, (_, i) => {
    const info: Record<string, string> = {}
    const put = (key: string, v: unknown): void => {
      if (v !== null) info[key] = String(v)
    }
    put('REVEL', pick(NUM, i))
    put('METARNN', pick(NUM, i * 3))
    put('SPLICEAI_MAX', pick(NUM, i * 5))
    put('LOEUF', pick(NUM, i * 7))
    put('GNOMAD_HOM', pick(HOM, i * 11))
    put('CLINVAR_REVSTAT', pick(REVSTAT, i * 13))
    return {
      gnomad_af: pick(AF, i),
      cadd: pick(CADD, i * 3),
      hpo_sim_score: pick(HPO, i * 7),
      func: pick(FUNC, i * 5),
      clinvar: pick(CLINVAR, i * 17),
      omim_mim_number: i % 2 === 0 ? '100100' : null,
      info_json: JSON.stringify(info)
    }
  })
}

describe('FULL_EVIDENCE_TEMPLATE', () => {
  it('is a valid ruleset that compiles and passes the shared validator', () => {
    expect(EvidenceRulesetSchema.safeParse(FULL_EVIDENCE_TEMPLATE).success).toBe(true)
    expect(() => compileRuleset(FULL_EVIDENCE_TEMPLATE)).not.toThrow()
    expect(rulesetProblems(FULL_EVIDENCE_TEMPLATE)).toEqual([])
  })

  it('ends every group with a 0-point reference rule', () => {
    for (const group of FULL_EVIDENCE_TEMPLATE.groups) {
      const last = group.rules[group.rules.length - 1]
      expect(isReferenceRule(last), group.id).toBe(true)
      expect(last.points).toBe(0)
    }
  })

  it('makes each group a partition: at most one non-reference bin per row, else the reference', () => {
    for (const group of FULL_EVIDENCE_TEMPLATE.groups) {
      const tests = group.rules.map((r) => {
        const c = compileRule(r.when)
        if (!c.ok) throw new Error(`${r.id}: ${c.errors.join(', ')}`)
        return { id: r.id, ref: isReferenceRule(r), test: c.predicate }
      })
      for (const row of rows()) {
        const bins = tests.filter((t) => !t.ref && t.test(row))
        expect(bins.length, `${group.id} ${JSON.stringify(row)}`).toBeLessThanOrEqual(1)
        if (bins.length === 0) expect(tests.find((t) => t.ref)!.test(row), group.id).toBe(true)
      }
    }
  })

  it('separates ≥ 2-star from other ClinVar P/LP', () => {
    const rule = (id: string) => {
      const c = compileRule(
        FULL_EVIDENCE_TEMPLATE.groups
          .find((g) => g.id === 'clinvar')!
          .rules.find((r) => r.id === id)!.when
      )
      if (!c.ok) throw new Error(id)
      return c.predicate
    }
    const row = (revstat: string) => ({
      clinvar: 'Pathogenic',
      info_json: JSON.stringify({ CLINVAR_REVSTAT: revstat })
    })
    expect(rule('clinvar_plp_2star')(row('reviewed by expert panel'))).toBe(true)
    expect(rule('clinvar_plp')(row('criteria provided, single submitter'))).toBe(true)
    expect(rule('clinvar_plp_2star')(row('criteria provided, single submitter'))).toBe(false)
  })
})
