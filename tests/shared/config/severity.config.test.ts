/**
 * The shared severity configuration (#469): impact ranks, ClinVar category
 * normalisation and ranks. Every stored rank and the cohort representative
 * order derive from it.
 */
import { describe, expect, it } from 'vitest'
import {
  CLINVAR_CATEGORIES,
  IMPACT_LEVELS,
  IMPACT_RANK_BY_LEVEL,
  UNKNOWN_SEVERITY_RANK,
  annotationSeverityRanks,
  clinvarCategory,
  clinvarRank,
  impactRank,
  impactRankCaseSql
} from '../../../src/shared/config/severity.config'

const rankOf = (id: string): number => CLINVAR_CATEGORIES.find((c) => c.id === id)!.rank

describe('impact ranks', () => {
  it('orders HIGH > MODERATE > LOW > MODIFIER > unknown', () => {
    expect(IMPACT_LEVELS.map((l) => l.level)).toEqual(['HIGH', 'MODERATE', 'LOW', 'MODIFIER'])
    expect(impactRank('HIGH')).toBeGreaterThan(impactRank('MODERATE'))
    expect(impactRank('MODERATE')).toBeGreaterThan(impactRank('LOW'))
    expect(impactRank('LOW')).toBeGreaterThan(impactRank('MODIFIER'))
    expect(impactRank('MODIFIER')).toBeGreaterThan(UNKNOWN_SEVERITY_RANK)
  })

  it('ranks NULL, empty and unknown text lowest', () => {
    for (const value of [null, undefined, '', '  ', 'missense_variant', 'HIGHER']) {
      expect(impactRank(value)).toBe(UNKNOWN_SEVERITY_RANK)
    }
  })

  it('ignores case and surrounding spaces for the stored rank', () => {
    expect(impactRank(' high ')).toBe(impactRank('HIGH'))
    expect(impactRank('Moderate')).toBe(impactRank('MODERATE'))
  })

  it('keeps the exact-key lookup case-sensitive', () => {
    expect(IMPACT_RANK_BY_LEVEL).toEqual({ HIGH: 4, MODERATE: 3, LOW: 2, MODIFIER: 1 })
    expect(IMPACT_RANK_BY_LEVEL['high']).toBeUndefined()
  })

  it('generates the backfill CASE from the same levels', () => {
    expect(impactRankCaseSql('v.consequence')).toBe(
      "CASE upper(trim(v.consequence)) WHEN 'HIGH' THEN 4 WHEN 'MODERATE' THEN 3 " +
        "WHEN 'LOW' THEN 2 WHEN 'MODIFIER' THEN 1 ELSE 0 END"
    )
  })
})

describe('ClinVar categories', () => {
  it('has unique, strictly descending positive ranks', () => {
    const ranks = CLINVAR_CATEGORIES.map((c) => c.rank)
    expect([...ranks].sort((a, b) => b - a)).toEqual(ranks)
    expect(new Set(ranks).size).toBe(ranks.length)
    expect(Math.min(...ranks)).toBeGreaterThan(UNKNOWN_SEVERITY_RANK)
  })

  it('orders the categories by severity', () => {
    expect(CLINVAR_CATEGORIES.map((c) => c.id)).toEqual([
      'pathogenic',
      'pathogenic_likely_pathogenic',
      'likely_pathogenic',
      'conflicting',
      'uncertain_significance',
      'risk_factor',
      'association',
      'affects',
      'drug_response',
      'other',
      'protective',
      'likely_benign',
      'benign_likely_benign',
      'benign',
      'not_provided'
    ])
  })

  it('maps no term to two categories', () => {
    const terms = CLINVAR_CATEGORIES.flatMap((c) => [...c.terms])
    expect(new Set(terms).size).toBe(terms.length)
  })

  it.each([
    ['Pathogenic', 'pathogenic'],
    ['pathogenic', 'pathogenic'],
    ['PATHOGENIC', 'pathogenic'],
    ['Likely pathogenic', 'likely_pathogenic'],
    ['Likely_pathogenic', 'likely_pathogenic'],
    ['likely_pathogenic', 'likely_pathogenic'],
    ['Pathogenic/Likely pathogenic', 'pathogenic_likely_pathogenic'],
    ['Pathogenic/Likely_pathogenic', 'pathogenic_likely_pathogenic'],
    ['pathogenic&likely_pathogenic', 'pathogenic_likely_pathogenic'],
    ['likely_pathogenic,pathogenic', 'pathogenic_likely_pathogenic'],
    ['Uncertain significance', 'uncertain_significance'],
    ['Uncertain_significance', 'uncertain_significance'],
    ['VUS', 'uncertain_significance'],
    ['Uncertain risk allele', 'uncertain_significance'],
    ['Conflicting classifications of pathogenicity', 'conflicting'],
    ['Conflicting_interpretations_of_pathogenicity', 'conflicting'],
    ['conflicting_interpretations_of_pathogenicity', 'conflicting'],
    ['Conflicting data from submitters', 'conflicting'],
    ['Likely benign', 'likely_benign'],
    ['Benign', 'benign'],
    ['Benign/Likely benign', 'benign_likely_benign'],
    ['Benign/Likely_benign', 'benign_likely_benign'],
    ['benign&likely_benign', 'benign_likely_benign'],
    ['risk factor', 'risk_factor'],
    ['risk_factor', 'risk_factor'],
    ['Established risk allele', 'risk_factor'],
    ['association', 'association'],
    ['drug response', 'drug_response'],
    ['drug_response', 'drug_response'],
    ['confers_sensitivity', 'drug_response'],
    ['protective', 'protective'],
    ['Affects', 'affects'],
    ['other', 'other'],
    ['not provided', 'not_provided'],
    ['not_provided', 'not_provided'],
    ['no_classification_for_the_single_variant', 'not_provided']
  ])('normalises %j to %s', (raw, category) => {
    expect(clinvarCategory(raw)).toBe(category)
    expect(clinvarRank(raw)).toBe(rankOf(category))
  })

  it.each([
    // most severe component wins, across every separator
    ['Pathogenic|risk_factor', 'pathogenic'],
    ['benign&pathogenic', 'pathogenic'],
    ['uncertain_significance&likely_benign', 'uncertain_significance'],
    ['Benign/Likely_benign|other', 'other'],
    ['Likely_benign|drug_response|other', 'drug_response'],
    ['likely_pathogenic; uncertain_significance', 'likely_pathogenic'],
    ['benign, likely_benign, uncertain_significance', 'uncertain_significance'],
    ['not_provided&benign', 'benign'],
    // conflicting stays ClinVar's own category, below likely pathogenic
    ['Conflicting_classifications_of_pathogenicity|risk_factor', 'conflicting'],
    ['conflicting_interpretations_of_pathogenicity&likely_pathogenic', 'likely_pathogenic'],
    ['uncertain_significance&conflicting_interpretations_of_pathogenicity', 'conflicting'],
    // a modifier is not a classification
    ['Pathogenic,_low_penetrance', 'pathogenic'],
    ['Likely pathogenic, low penetrance', 'likely_pathogenic'],
    // unrecognised components do not hide recognised ones
    ['Pathogenic|some_new_term', 'pathogenic'],
    // odd spacing and case
    ['  PATHOGENIC /  likely   Pathogenic ', 'pathogenic_likely_pathogenic'],
    ['Tier IV – Benign/Likely benign', 'other']
  ])('multi-valued or odd %j is %s', (raw, category) => {
    expect(clinvarCategory(raw)).toBe(category)
  })

  it('never derives conflicting from disagreeing components', () => {
    expect(clinvarCategory('pathogenic&benign')).toBe('pathogenic')
  })

  it.each([null, undefined, '', '   ', 'something else', 'low_penetrance', '&&', '/'])(
    'ranks %j as unknown',
    (raw) => {
      expect(clinvarCategory(raw)).toBeNull()
      expect(clinvarRank(raw)).toBe(UNKNOWN_SEVERITY_RANK)
    }
  )

  it('ranks pathogenic above uncertain significance above benign', () => {
    expect(clinvarRank('Pathogenic')).toBeGreaterThan(clinvarRank('Uncertain significance'))
    expect(clinvarRank('Uncertain significance')).toBeGreaterThan(clinvarRank('Benign'))
    expect(clinvarRank('Benign')).toBeGreaterThan(clinvarRank('not provided'))
  })
})

describe('annotationSeverityRanks', () => {
  it('ranks the consequence (impact) and clinvar columns of a row', () => {
    expect(annotationSeverityRanks({ consequence: 'HIGH', clinvar: 'Pathogenic' })).toEqual({
      impact_rank: 4,
      clinvar_rank: 15
    })
  })

  it('gives 0 for missing or non-string values', () => {
    expect(annotationSeverityRanks({})).toEqual({ impact_rank: 0, clinvar_rank: 0 })
    expect(annotationSeverityRanks({ consequence: 4, clinvar: null })).toEqual({
      impact_rank: 0,
      clinvar_rank: 0
    })
  })
})
