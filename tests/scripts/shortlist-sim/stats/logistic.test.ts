import { describe, expect, it } from 'vitest'
import { compileRuleset } from '../../../../src/main/services/scoring/evidence'
import { VARVIS_EVIDENCE_TEMPLATE } from '../../../../src/shared/config/evidence-rulesets/varvis-template'
import type { EvidenceRuleset, ModeId } from '../../../../src/shared/types/evidence-ruleset'
import type { ScenarioId } from '../../../../scripts/shortlist-sim/common/types'
import { fitLogisticPoints } from '../../../../scripts/shortlist-sim/stats/logistic'
import { tuneRuleset, type Assignment } from '../../../../scripts/shortlist-sim/stats/tune'

const many = (
  n: number,
  gene: string,
  mode: ModeId,
  bins: Record<string, string>,
  scenario: ScenarioId = 'primary'
): Assignment[] => Array.from({ length: n }, () => ({ gene, mode, bins, scenario }))

const twoGroupTemplate: EvidenceRuleset = {
  version: 1,
  id: 'collinear-test',
  modes: [
    { id: 'ad', label: 'AD', when: 'moi:~:AD AND zygosity:=:het', points: 0 },
    { id: 'fallback', label: 'Fallback', when: null, points: 0 }
  ],
  groups: [
    {
      id: 'pred_a',
      label: 'Predictor A',
      scope: 'global',
      rules: [
        { id: 'a_hi', label: 'A high', when: 'cadd:>=:25', points: 0 },
        { id: 'a_ref', label: 'A ref', when: 'func:is:notnull OR func:is:null', points: 0 }
      ]
    },
    {
      id: 'pred_b',
      label: 'Predictor B',
      scope: 'global',
      rules: [
        { id: 'b_hi', label: 'B high', when: 'revel:>=:0.7', points: 0 },
        { id: 'b_ref', label: 'B ref', when: 'func:is:notnull OR func:is:null', points: 0 }
      ]
    }
  ]
}

describe('fitLogisticPoints (#640)', () => {
  it('splits weight across collinear predictors instead of double-counting like marginal estimatePoints', () => {
    // True signal is +4 log2-odds (80:5 = 16:1 odds ratio relative to the 100:100 = 1:1 reference bin),
    // observed through two 100% collinear rule groups (a_hi and b_hi always co-occur).
    const positives = [
      ...many(80, 'G1', 'fallback', { pred_a: 'a_hi', pred_b: 'b_hi' }),
      ...many(100, 'G1', 'fallback', { pred_a: 'a_ref', pred_b: 'b_ref' })
    ]
    const background = [
      ...many(5, 'G1', 'fallback', { pred_a: 'a_hi', pred_b: 'b_hi' }),
      ...many(100, 'G1', 'fallback', { pred_a: 'a_ref', pred_b: 'b_ref' })
    ]

    const marginal = tuneRuleset(twoGroupTemplate, { positives, background }, () => true, [], {
      id: 'marginal'
    })
    const joint = fitLogisticPoints(twoGroupTemplate, { positives, background }, () => true, [], {
      id: 'joint',
      lambda: 0.1
    })

    const mA = marginal.support.find((s) => s.bin === 'a_hi')!.points
    const mB = marginal.support.find((s) => s.bin === 'b_hi')!.points
    const jA = joint.support.find((s) => s.bin === 'a_hi')!.points
    const jB = joint.support.find((s) => s.bin === 'b_hi')!.points

    // Marginal tuning gives each duplicate predictor the full +4 points (total +8, double-counted).
    expect(mA).toBe(4)
    expect(mB).toBe(4)
    expect(mA + mB).toBe(8)

    // Joint L2 logistic regression splits the +4 log2-odds evenly (+2 each, total +4) and keeps 0 on reference bins.
    expect(jA).toBe(2)
    expect(jB).toBe(2)
    expect(jA + jB).toBe(4)
    expect(joint.support.find((s) => s.bin === 'a_ref')!.points).toBe(0)
    expect(joint.support.find((s) => s.bin === 'b_ref')!.points).toBe(0)
  })

  it('recovers true log2-odds on independent predictors while keeping 0 on reference bins', () => {
    // Generative model: logit P(Y=1) = 0 + 3*ln(2)*I(a_hi) + 2*ln(2)*I(b_hi)
    // Cell (0,0): odds 1:1 (100 pos, 100 bg)
    // Cell (1,0): odds 8:1 (80 pos, 10 bg) -> +3 log2-odds
    // Cell (0,1): odds 4:1 (40 pos, 10 bg) -> +2 log2-odds
    // Cell (1,1): odds 32:1 (320 pos, 10 bg) -> +5 log2-odds
    const positives = [
      ...many(100, 'G1', 'fallback', { pred_a: 'a_ref', pred_b: 'b_ref' }),
      ...many(80, 'G1', 'fallback', { pred_a: 'a_hi', pred_b: 'b_ref' }),
      ...many(40, 'G1', 'fallback', { pred_a: 'a_ref', pred_b: 'b_hi' }),
      ...many(320, 'G1', 'fallback', { pred_a: 'a_hi', pred_b: 'b_hi' })
    ]
    const background = [
      ...many(100, 'G1', 'fallback', { pred_a: 'a_ref', pred_b: 'b_ref' }),
      ...many(10, 'G1', 'fallback', { pred_a: 'a_hi', pred_b: 'b_ref' }),
      ...many(10, 'G1', 'fallback', { pred_a: 'a_ref', pred_b: 'b_hi' }),
      ...many(10, 'G1', 'fallback', { pred_a: 'a_hi', pred_b: 'b_hi' })
    ]

    const res = fitLogisticPoints(twoGroupTemplate, { positives, background }, () => true, [], {
      lambda: 0.01
    })
    expect(res.support.find((s) => s.bin === 'a_hi')!.points).toBe(3)
    expect(res.support.find((s) => s.bin === 'b_hi')!.points).toBe(2)
    expect(res.support.find((s) => s.bin === 'a_ref')!.points).toBe(0)
    expect(res.support.find((s) => s.bin === 'b_ref')!.points).toBe(0)
  })

  it('allows ClinVar P/LP above +8 (up to +24) and compiles cleanly', () => {
    const positives = [
      ...many(50, 'G1', 'ad', { effect: 'lof', freq: 'af_missing' }),
      ...many(50, 'G1', 'fallback', { effect: 'effect_ref', freq: 'af_ref' }),
      ...many(1024, 'G1', 'fallback', { clinvar: 'clinvar_plp' }, 'clinvar_visible'),
      ...many(10, 'G1', 'fallback', { clinvar: 'clinvar_ref' }, 'clinvar_visible')
    ]
    const background = [
      ...many(10, 'G1', 'ad', { effect: 'lof', freq: 'af_ref' }),
      ...many(500, 'G1', 'fallback', { effect: 'effect_ref', freq: 'af_ref' }),
      ...many(1, 'G1', 'fallback', { clinvar: 'clinvar_plp' }, 'clinvar_visible'),
      ...many(1024, 'G1', 'fallback', { clinvar: 'clinvar_ref' }, 'clinvar_visible')
    ]

    const res = fitLogisticPoints(VARVIS_EVIDENCE_TEMPLATE, { positives, background })
    const plp = res.support.find((s) => s.group === 'clinvar' && s.bin === 'clinvar_plp')!
    expect(plp.points).toBeGreaterThan(8)
    expect(plp.points).toBeLessThanOrEqual(24)
    expect(() => compileRuleset(res.ruleset)).not.toThrow()
  })
})
