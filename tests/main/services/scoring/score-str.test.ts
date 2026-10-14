import path from 'path'
import { readFileSync } from 'fs'
import { describe, it, expect } from 'vitest'
import { scoreStr } from '../../../../src/main/services/scoring/score-str'
import { scoreRow } from '../../../../src/main/services/scoring'
import { buildShortlistCandidate } from '../../../fixtures/shortlist/cross-type-variant-fixture'
import { extractStrFields } from '../../../../src/main/import/vcf/extension-parsers'

const STR_VCF = path.join(__dirname, '../../../test-data/vcf/synthetic-str.vcf')

/** STR_STATUS as the importer stores it, keyed by REPID, straight from the Stranger fixture. */
function fixtureStatuses(): Map<string, string | null> {
  const out = new Map<string, string | null>()
  for (const line of readFileSync(STR_VCF, 'utf-8').split('\n')) {
    if (line.startsWith('#') || line.trim() === '') continue
    const info = new Map(
      line
        .split('\t')[7]
        .split(';')
        .map((kv) => kv.split('=') as [string, string])
    )
    const str = extractStrFields(info, new Map())
    out.set(str.repeat_id!, str.str_status)
  }
  return out
}

const WEIGHTS = { impact: 1, pathogenicity: 1, rarity: 1, clinvar: 1, phenotype: 0 }

describe('scoreStr()', () => {
  it('full_mutation status with known disease -> impact + pathogenicity, no ClinVar without annotation', () => {
    const row = buildShortlistCandidate({
      variant_type: 'str',
      str_status: 'full_mutation',
      str_disease: "Huntington's disease"
    })
    expect(scoreStr(row)).toMatchInlineSnapshot(`
      {
        "clinvar": 0,
        "impact": 1,
        "pathogenicity": 1,
        "phenotype": 0,
        "rarity": 1,
      }
    `)
  })

  it('pre_mutation status -> impact 0.66', () => {
    const row = buildShortlistCandidate({
      variant_type: 'str',
      str_status: 'pre_mutation',
      str_disease: null
    })
    expect(scoreStr(row).impact).toBe(0.66)
  })

  it('unknown locus -> pathogenicity 0.5', () => {
    const row = buildShortlistCandidate({
      variant_type: 'str',
      str_status: 'full_mutation',
      str_disease: null
    })
    expect(scoreStr(row).pathogenicity).toBe(0.5)
  })

  it('empty-string disease treated as unknown', () => {
    const row = buildShortlistCandidate({
      variant_type: 'str',
      str_status: 'full_mutation',
      str_disease: '   '
    })
    expect(scoreStr(row).pathogenicity).toBe(0.5)
  })

  it('normal status -> impact 0', () => {
    const row = buildShortlistCandidate({
      variant_type: 'str',
      str_status: 'normal',
      str_disease: null
    })
    expect(scoreStr(row).impact).toBe(0)
  })

  it('null status -> impact 0', () => {
    const row = buildShortlistCandidate({
      variant_type: 'str',
      str_status: null,
      str_disease: null
    })
    expect(scoreStr(row).impact).toBe(0)
  })

  it('unknown locus falls back to mapClinvarBoost', () => {
    const row = buildShortlistCandidate({
      variant_type: 'str',
      str_status: 'pre_mutation',
      str_disease: null,
      clinvar: 'Pathogenic'
    })
    expect(scoreStr(row).clinvar).toBe(1)
  })

  it.each(['full_mutation', 'pre_mutation', 'normal', null] as const)(
    'known locus with status %s and no ClinVar annotation never claims ClinVar evidence',
    (status) => {
      const row = buildShortlistCandidate({
        variant_type: 'str',
        str_status: status,
        str_disease: 'Friedreich ataxia',
        clinvar: null
      })
      expect(scoreStr(row).clinvar).toBe(0)
      expect(scoreRow(row, { weights: WEIGHTS, clinvarPinTop: true }).rank_clinvar_pinned).toBe(
        false
      )
    }
  )

  it.each([
    ['Pathogenic', 1],
    ['Likely_pathogenic', 0.9]
  ] as const)(
    'known locus with ClinVar %s keeps the annotation boost and pins',
    (clinvar, boost) => {
      const row = buildShortlistCandidate({
        variant_type: 'str',
        str_status: 'full_mutation',
        str_disease: 'Friedreich ataxia',
        clinvar
      })
      expect(scoreStr(row).clinvar).toBe(boost)
      expect(scoreRow(row, { weights: WEIGHTS, clinvarPinTop: true }).rank_clinvar_pinned).toBe(
        true
      )
    }
  )

  it.each([
    ['normal,full_mutation', 1],
    ['pre_mutation,normal', 0.66],
    ['full_mutation,pre_mutation', 1],
    ['normal,normal', 0]
  ] as const)('unsplit per-allele status %s scores the most severe allele', (status, impact) => {
    const row = buildShortlistCandidate({ variant_type: 'str', str_status: status })
    expect(scoreStr(row).impact).toBe(impact)
  })

  it('scores the Stranger vocabulary from the fixture VCF', () => {
    const statuses = fixtureStatuses()
    const impact = (repId: string): number =>
      scoreStr(buildShortlistCandidate({ variant_type: 'str', str_status: statuses.get(repId) }))
        .impact
    expect(statuses.get('CSTB')).toBe('full_mutation')
    expect(impact('CSTB')).toBe(1)
    expect(impact('NOTCH2NLC')).toBe(0)
  })

  it('rarity is always 1.0', () => {
    const row = buildShortlistCandidate({
      variant_type: 'str',
      str_status: 'full_mutation',
      str_disease: 'Fragile X syndrome'
    })
    expect(scoreStr(row).rarity).toBe(1)
  })
})
