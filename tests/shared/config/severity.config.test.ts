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
  impactRankCaseSql,
  takeUnrankedClinvarStrings
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
    ['uncertain_significance&likely_benign', 'uncertain_significance'],
    // a classification on the pathogenicity axis is not outranked by a term of
    // another kind attached to it (ClinVar: `|` separates classification types)
    ['Benign/Likely_benign|other', 'benign_likely_benign'],
    ['Likely_benign|drug_response|other', 'likely_benign'],
    ['Benign|risk_factor', 'benign'],
    ['drug_response|other', 'drug_response'],
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

  it.each([
    // VEP CLIN_SIG lists every record of the co-located variant, without
    // ClinVar's own aggregate: pathogenic next to benign is a conflict.
    ['pathogenic&benign', 'conflicting'],
    ['benign&pathogenic', 'conflicting'],
    ['likely_benign,likely_pathogenic', 'conflicting'],
    ['Pathogenic(1)|Benign(3)', 'conflicting'],
    ['Pathogenic/Likely_pathogenic&Benign/Likely_benign', 'conflicting'],
    // not a conflict of the two sides: the most severe wins
    ['pathogenic&uncertain_significance', 'pathogenic'],
    ['uncertain_significance&benign', 'uncertain_significance']
  ])('derives a conflict only from a pathogenic and a benign side: %j is %s', (raw, category) => {
    expect(clinvarCategory(raw)).toBe(category)
  })

  it.each([
    // abbreviations
    ['P', 'pathogenic'],
    ['LP', 'likely_pathogenic'],
    ['P/LP', 'pathogenic_likely_pathogenic'],
    ['VUS', 'uncertain_significance'],
    ['LB', 'likely_benign'],
    ['B', 'benign'],
    ['B/LB', 'benign_likely_benign'],
    // hyphen and space forms, synonyms
    ['likely-pathogenic', 'likely_pathogenic'],
    ['Likely-Benign', 'likely_benign'],
    ['probable-pathogenic', 'likely_pathogenic'],
    ['probably pathogenic', 'likely_pathogenic'],
    ['probable pathogenic', 'likely_pathogenic'],
    ['uncertain-significance', 'uncertain_significance'],
    ['VUS-high', 'uncertain_significance'],
    // CLNSIGCONF counts and other parenthesised suffixes
    ['Pathogenic(1)', 'pathogenic'],
    ['Uncertain_significance(2)|Likely_benign(1)', 'uncertain_significance'],
    ['Likely pathogenic (2 submitters)', 'likely_pathogenic'],
    // numeric codes of the legacy ClinVar VCF
    ['5', 'pathogenic'],
    ['4', 'likely_pathogenic'],
    ['3', 'likely_benign'],
    ['2', 'benign'],
    ['1', 'not_provided'],
    ['0', 'uncertain_significance'],
    ['6', 'drug_response'],
    ['7', 'other'],
    ['255', 'other'],
    ['5|255', 'pathogenic'],
    // placeholders
    ['.', 'not_provided'],
    ['-', 'not_provided']
  ])('recognises the real-world spelling %j as %s', (raw, category) => {
    expect(clinvarCategory(raw)).toBe(category)
  })

  it('ranks the abbreviation P above VUS (a JSON import must not invert them)', () => {
    expect(clinvarRank('P')).toBeGreaterThan(clinvarRank('VUS'))
    expect(clinvarRank('LP')).toBeGreaterThan(clinvarRank('VUS'))
    expect(clinvarRank('VUS')).toBeGreaterThan(clinvarRank('LB'))
  })

  it('collects the distinct strings it could not rank, once', () => {
    takeUnrankedClinvarStrings()
    for (const raw of ['Pathogenic', 'weird value', 'weird value', null, '', '  ', 'another one']) {
      clinvarRank(raw)
    }
    expect(takeUnrankedClinvarStrings()).toEqual(['weird value', 'another one'])
    expect(takeUnrankedClinvarStrings()).toEqual([])
    // A string seen before is reported again by the next import.
    clinvarRank('weird value')
    expect(takeUnrankedClinvarStrings()).toEqual(['weird value'])
  })

  it.each([null, undefined, '', '   ', 'something else', 'low_penetrance', '&&', '/', '9', '(1)'])(
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
