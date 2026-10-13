import { describe, it, expect } from 'vitest'
import {
  VARVIS_EVIDENCE_TEMPLATE,
  REFERENCE_RULE_IDS
} from '../../../src/shared/config/evidence-rulesets/varvis-template'
import { compileRule } from '../../../src/shared/dsl/evaluate'
import { EvidenceRulesetSchema } from '../../../src/shared/types/evidence-ruleset-schemas'
import { compileRuleset } from '../../../src/main/services/scoring/evidence/ruleset'

const AF = [null, 0, 0.000005, 0.00001, 0.00005, 0.0001, 0.0005, 0.001, 0.005, 0.01]
const CADD = [null, 0, 14.9, 15, 19.9, 20, 24.9, 25, 29.9, 30, 45]
const HPO = [null, -0.1, 0, 0.01, 0.05, 0.09, 0.1, 0.149, 0.15, 0.4]
const FUNC = [null, 'stop_gained', 'missense_variant', 'inframe_indel', 'mnv', 'synonymous_variant']
const CLINVAR = [
  null,
  '',
  'Pathogenic',
  'Likely_benign',
  'Uncertain_significance',
  'Conflicting_classifications_of_pathogenicity'
]

function rows(): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = []
  for (let i = 0; i < 400; i++) {
    out.push({
      gnomad_af: AF[i % AF.length],
      cadd: CADD[i % CADD.length],
      hpo_sim_score: HPO[(i * 7) % HPO.length],
      func: FUNC[(i * 3) % FUNC.length],
      clinvar: CLINVAR[(i * 5) % CLINVAR.length],
      omim_mim_number: i % 2 === 0 ? '100100' : null
    })
  }
  return out
}

describe('VARVIS_EVIDENCE_TEMPLATE', () => {
  it('is a valid ruleset that compiles', () => {
    expect(EvidenceRulesetSchema.safeParse(VARVIS_EVIDENCE_TEMPLATE).success).toBe(true)
    expect(() => compileRuleset(VARVIS_EVIDENCE_TEMPLATE)).not.toThrow()
  })

  it('ends every group with a 0-point reference rule', () => {
    for (const group of VARVIS_EVIDENCE_TEMPLATE.groups) {
      const last = group.rules[group.rules.length - 1]
      expect(REFERENCE_RULE_IDS.has(last.id)).toBe(true)
      expect(last.points).toBe(0)
    }
  })

  it('makes each group a partition: every row matches exactly one non-reference bin or only the reference', () => {
    for (const group of VARVIS_EVIDENCE_TEMPLATE.groups) {
      const tests = group.rules.map((r) => {
        const c = compileRule(r.when)
        if (!c.ok) throw new Error(`${r.id}: ${c.errors.join(', ')}`)
        return { id: r.id, test: c.predicate }
      })
      for (const row of rows()) {
        const bins = tests.filter((t) => !REFERENCE_RULE_IDS.has(t.id) && t.test(row))
        const reference = tests.find((t) => REFERENCE_RULE_IDS.has(t.id))!
        expect(bins.length, `${group.id} ${JSON.stringify(row)}`).toBeLessThanOrEqual(1)
        if (bins.length === 0) expect(reference.test(row), `${group.id} reference`).toBe(true)
      }
    }
  })
})

describe('VARVIS_EVIDENCE_TEMPLATE — X-linked mode', () => {
  const xl = VARVIS_EVIDENCE_TEMPLATE.modes.find((m) => m.id === 'xl')!
  const compiled = compileRule(xl.when!)
  if (!compiled.ok) throw new Error(compiled.errors.join(', '))
  const fits = (row: Record<string, unknown>): boolean => compiled.predicate(row)

  it.each(['XR', 'XLR', 'X-linked recessive inheritance', 'AR, XR'])(
    'accepts a hemizygous call for moi %s',
    (moi) => {
      expect(fits({ chr: 'chrX', moi, zygosity: 'hemi' })).toBe(true)
    }
  )

  it.each(['XD', 'XLD'])('accepts a heterozygous call for X-linked dominant (%s)', (moi) => {
    expect(fits({ chr: 'X', moi, zygosity: 'het' })).toBe(true)
  })

  it('gives no credit to missing or reference genotypes, or to het in an X-linked recessive gene', () => {
    expect(fits({ chr: 'X', moi: 'XD', zygosity: null })).toBe(false)
    expect(fits({ chr: 'X', moi: 'XLD', zygosity: null })).toBe(false)
    expect(fits({ chr: 'X', moi: 'XR', zygosity: 'het' })).toBe(false)
    expect(fits({ chr: '1', moi: 'AR', zygosity: 'hom' })).toBe(false)
  })
})
