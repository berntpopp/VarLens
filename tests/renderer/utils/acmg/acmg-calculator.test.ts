import { describe, it, expect } from 'vitest'
import {
  calculatePoints,
  classifyByRules,
  calculateClassification
} from '../../../../src/renderer/src/utils/acmg/acmg-calculator'
import type { AcmgEvidenceCode } from '../../../../src/renderer/src/utils/acmg/types'
import { strengthOptionsFor } from '../../../../src/renderer/src/utils/acmg/types'

function makeCode(code: string, strength: string): AcmgEvidenceCode {
  return {
    code: code as AcmgEvidenceCode['code'],
    strength: strength as AcmgEvidenceCode['strength'],
    auto_suggested: false,
    confirmed: true
  }
}

function makeBenignCode(code: string, strength: string): AcmgEvidenceCode {
  return makeCode(code, strength)
}

describe('calculatePoints', () => {
  it('returns 0 for empty evidence arrays', () => {
    expect(calculatePoints([], [])).toEqual({
      pathogenicPoints: 0,
      benignPoints: 0,
      netPoints: 0
    })
  })

  it('calculates PVS1 as +8 points', () => {
    const pathogenic = [makeCode('PVS1', 'very_strong')]
    expect(calculatePoints(pathogenic, [])).toEqual({
      pathogenicPoints: 8,
      benignPoints: 0,
      netPoints: 8
    })
  })

  it('calculates PS + PM as +4 + +2 = +6 points', () => {
    const pathogenic = [makeCode('PS1', 'strong'), makeCode('PM2', 'moderate')]
    expect(calculatePoints(pathogenic, [])).toEqual({
      pathogenicPoints: 6,
      benignPoints: 0,
      netPoints: 6
    })
  })

  it('calculates benign evidence as negative points', () => {
    const benign = [makeCode('BA1', 'stand_alone')]
    expect(calculatePoints([], benign)).toEqual({
      pathogenicPoints: 0,
      benignPoints: 8,
      netPoints: -8
    })
  })

  it('calculates net points from mixed evidence', () => {
    const pathogenic = [makeCode('PVS1', 'very_strong'), makeCode('PM2', 'moderate')]
    const benign = [makeCode('BP4', 'supporting')]
    expect(calculatePoints(pathogenic, benign)).toEqual({
      pathogenicPoints: 10,
      benignPoints: 1,
      netPoints: 9
    })
  })

  it('only counts confirmed codes', () => {
    const pathogenic: AcmgEvidenceCode[] = [
      { code: 'PVS1', strength: 'very_strong', auto_suggested: false, confirmed: true },
      { code: 'PS1', strength: 'strong', auto_suggested: true, confirmed: false }
    ]
    expect(calculatePoints(pathogenic, [])).toEqual({
      pathogenicPoints: 8,
      benignPoints: 0,
      netPoints: 8
    })
  })
})

describe('classifyByRules (ACMG/AMP 2015)', () => {
  // --- Pathogenic rules ---
  it('PVS1 alone = VUS (not LP)', () => {
    const p = [makeCode('PVS1', 'very_strong')]
    expect(classifyByRules(p, [])).toBe('Uncertain significance')
  })

  it('PVS1 + PS = Pathogenic', () => {
    const p = [makeCode('PVS1', 'very_strong'), makeCode('PS1', 'strong')]
    expect(classifyByRules(p, [])).toBe('Pathogenic')
  })

  it('PVS1 + 2 PM = Pathogenic', () => {
    const p = [
      makeCode('PVS1', 'very_strong'),
      makeCode('PM1', 'moderate'),
      makeCode('PM2', 'moderate')
    ]
    expect(classifyByRules(p, [])).toBe('Pathogenic')
  })

  it('PVS1 + PM + PP = Pathogenic', () => {
    const p = [
      makeCode('PVS1', 'very_strong'),
      makeCode('PM2', 'moderate'),
      makeCode('PP3', 'supporting')
    ]
    expect(classifyByRules(p, [])).toBe('Pathogenic')
  })

  it('PVS1 + 2 PP = Pathogenic', () => {
    const p = [
      makeCode('PVS1', 'very_strong'),
      makeCode('PP1', 'supporting'),
      makeCode('PP3', 'supporting')
    ]
    expect(classifyByRules(p, [])).toBe('Pathogenic')
  })

  it('2 PS = Pathogenic', () => {
    const p = [makeCode('PS1', 'strong'), makeCode('PS2', 'strong')]
    expect(classifyByRules(p, [])).toBe('Pathogenic')
  })

  it('PS + 3 PM = Pathogenic', () => {
    const p = [
      makeCode('PS1', 'strong'),
      makeCode('PM1', 'moderate'),
      makeCode('PM2', 'moderate'),
      makeCode('PM3', 'moderate')
    ]
    expect(classifyByRules(p, [])).toBe('Pathogenic')
  })

  // --- Likely Pathogenic rules ---
  it('PVS1 + PM = Likely Pathogenic', () => {
    const p = [makeCode('PVS1', 'very_strong'), makeCode('PM2', 'moderate')]
    expect(classifyByRules(p, [])).toBe('Likely pathogenic')
  })

  it('PVS1 + PP = Likely Pathogenic', () => {
    const p = [makeCode('PVS1', 'very_strong'), makeCode('PP3', 'supporting')]
    expect(classifyByRules(p, [])).toBe('Likely pathogenic')
  })

  it('PS + PM = Likely Pathogenic', () => {
    const p = [makeCode('PS1', 'strong'), makeCode('PM2', 'moderate')]
    expect(classifyByRules(p, [])).toBe('Likely pathogenic')
  })

  it('PS + 2 PP = Likely Pathogenic', () => {
    const p = [
      makeCode('PS1', 'strong'),
      makeCode('PP1', 'supporting'),
      makeCode('PP3', 'supporting')
    ]
    expect(classifyByRules(p, [])).toBe('Likely pathogenic')
  })

  it('3 PM = Likely Pathogenic', () => {
    const p = [
      makeCode('PM1', 'moderate'),
      makeCode('PM2', 'moderate'),
      makeCode('PM3', 'moderate')
    ]
    expect(classifyByRules(p, [])).toBe('Likely pathogenic')
  })

  it('2 PM + 2 PP = Likely Pathogenic', () => {
    const p = [
      makeCode('PM1', 'moderate'),
      makeCode('PM2', 'moderate'),
      makeCode('PP1', 'supporting'),
      makeCode('PP3', 'supporting')
    ]
    expect(classifyByRules(p, [])).toBe('Likely pathogenic')
  })

  it('1 PM + 4 PP = Likely Pathogenic', () => {
    const p = [
      makeCode('PM2', 'moderate'),
      makeCode('PP1', 'supporting'),
      makeCode('PP2', 'supporting'),
      makeCode('PP3', 'supporting'),
      makeCode('PP4', 'supporting')
    ]
    expect(classifyByRules(p, [])).toBe('Likely pathogenic')
  })

  // --- VUS cases ---
  it('PS alone = VUS', () => {
    const p = [makeCode('PS1', 'strong')]
    expect(classifyByRules(p, [])).toBe('Uncertain significance')
  })

  it('1 PM = VUS', () => {
    const p = [makeCode('PM2', 'moderate')]
    expect(classifyByRules(p, [])).toBe('Uncertain significance')
  })

  it('2 PM = VUS', () => {
    const p = [makeCode('PM1', 'moderate'), makeCode('PM2', 'moderate')]
    expect(classifyByRules(p, [])).toBe('Uncertain significance')
  })

  it('1 PP = VUS', () => {
    const p = [makeCode('PP3', 'supporting')]
    expect(classifyByRules(p, [])).toBe('Uncertain significance')
  })

  it('PS + 1 PP = VUS', () => {
    const p = [makeCode('PS1', 'strong'), makeCode('PP3', 'supporting')]
    expect(classifyByRules(p, [])).toBe('Uncertain significance')
  })

  // --- Benign rules ---
  it('BA1 = Benign (stand-alone)', () => {
    const b = [makeBenignCode('BA1', 'stand_alone')]
    expect(classifyByRules([], b)).toBe('Benign')
  })

  it('2 BS = Benign', () => {
    const b = [makeBenignCode('BS1', 'strong'), makeBenignCode('BS2', 'strong')]
    expect(classifyByRules([], b)).toBe('Benign')
  })

  // --- Likely Benign rules ---
  it('BS + BP = Likely Benign', () => {
    const b = [makeBenignCode('BS1', 'strong'), makeBenignCode('BP4', 'supporting')]
    expect(classifyByRules([], b)).toBe('Likely benign')
  })

  it('2 BP = Likely Benign', () => {
    const b = [makeBenignCode('BP4', 'supporting'), makeBenignCode('BP7', 'supporting')]
    expect(classifyByRules([], b)).toBe('Likely benign')
  })

  it('1 BS alone = VUS', () => {
    const b = [makeBenignCode('BS1', 'strong')]
    expect(classifyByRules([], b)).toBe('Uncertain significance')
  })

  it('1 BP alone = VUS', () => {
    const b = [makeBenignCode('BP4', 'supporting')]
    expect(classifyByRules([], b)).toBe('Uncertain significance')
  })

  // --- Conflicting evidence: pathogenic should override weak benign ---
  it('PVS1 + PS1 + 2 BP = Pathogenic (strong pathogenic overrides weak benign)', () => {
    const p = [makeCode('PVS1', 'very_strong'), makeCode('PS1', 'strong')]
    const b = [makeBenignCode('BP4', 'supporting'), makeBenignCode('BP7', 'supporting')]
    expect(classifyByRules(p, b)).toBe('Pathogenic')
  })

  it('BA1 + PVS1 + PS1 = Benign (BA1 stand-alone always wins)', () => {
    const p = [makeCode('PVS1', 'very_strong'), makeCode('PS1', 'strong')]
    const b = [makeBenignCode('BA1', 'stand_alone')]
    expect(classifyByRules(p, b)).toBe('Benign')
  })
})

describe('calculateClassification', () => {
  it('returns null for empty evidence', () => {
    expect(calculateClassification([], [])).toEqual({
      classification: null,
      pathogenicPoints: 0,
      benignPoints: 0,
      netPoints: 0
    })
  })

  it('calculates Pathogenic from PVS1 + PM2 + PP3', () => {
    const pathogenic = [
      makeCode('PVS1', 'very_strong'),
      makeCode('PM2', 'moderate'),
      makeCode('PP3', 'supporting')
    ]
    const result = calculateClassification(pathogenic, [])
    expect(result.classification).toBe('Pathogenic')
    expect(result.netPoints).toBe(11)
  })

  it('calculates Benign from BA1', () => {
    const benign = [makeCode('BA1', 'stand_alone')]
    const result = calculateClassification([], benign)
    expect(result.classification).toBe('Benign')
    expect(result.netPoints).toBe(-8)
  })

  it('PVS1 alone is VUS', () => {
    const pathogenic = [makeCode('PVS1', 'very_strong')]
    const result = calculateClassification(pathogenic, [])
    expect(result.classification).toBe('Uncertain significance')
  })
})

// #497: a strength change must not drop a criterion from the rule check.
describe('benign criteria at a non-default strength', () => {
  it('BP4 raised to Moderate still counts as supporting: BP4 + BP7 stays Likely benign', () => {
    const benign = [makeCode('BP4', 'moderate'), makeCode('BP7', 'supporting')]
    expect(classifyByRules([], benign)).toBe('Likely benign')
  })

  it('BS1 raised to Very Strong still counts as strong: BS1 + BS2 stays Benign', () => {
    const benign = [makeCode('BS1', 'very_strong'), makeCode('BS2', 'strong')]
    expect(classifyByRules([], benign)).toBe('Benign')
  })

  it('offers Stand-Alone for BA1 only', () => {
    const offered = (code: AcmgEvidenceCode['code']): string[] =>
      strengthOptionsFor(code).map((o) => o.value)
    expect(offered('BA1')).toContain('stand_alone')
    expect(offered('PVS1')).toEqual(['very_strong', 'strong', 'moderate', 'supporting'])
    expect(offered('BS1')).not.toContain('stand_alone')
  })
})
