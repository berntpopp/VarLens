import { describe, it, expect } from 'vitest'
import {
  parseRankingFile,
  rankingFileName,
  serializeRanking
} from '../../../src/renderer/src/utils/shortlist-ranking-io'
import { VARVIS_EVIDENCE_TEMPLATE } from '../../../src/shared/config/evidence-rulesets/varvis-template'
import type { ShortlistConfig } from '../../../src/shared/types/shortlist'

const config: ShortlistConfig = {
  variantTypeScope: ['snv'],
  topN: 10,
  baseFilters: {},
  rankConfig: {
    weights: { impact: 0, pathogenicity: 0, rarity: 0, clinvar: 0, phenotype: 0 },
    ruleset: { ...VARVIS_EVIDENCE_TEMPLATE, sha256: 'b'.repeat(64) }
  }
}

describe('shortlist-ranking-io', () => {
  it('round-trips a ranking and drops the artifact hash', () => {
    const result = parseRankingFile(serializeRanking({ name: 'Lab', description: null, config }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.name).toBe('Lab')
    expect(result.config.rankConfig.ruleset?.sha256).toBeUndefined()
    expect(result.config.rankConfig.ruleset?.groups).toEqual(VARVIS_EVIDENCE_TEMPLATE.groups)
  })

  it('rejects other JSON, invalid configs and weighted rankings', () => {
    expect(parseRankingFile('not json')).toMatchObject({ ok: false })
    expect(parseRankingFile('{"format":"other","name":"x"}')).toMatchObject({ ok: false })
    const bad = serializeRanking({
      name: 'x',
      description: null,
      config: { ...config, topN: 9999 }
    })
    expect(parseRankingFile(bad)).toMatchObject({ ok: false, error: expect.stringMatching(/topN/) })
    const weighted = { ...config, rankConfig: { weights: config.rankConfig.weights } }
    expect(
      parseRankingFile(serializeRanking({ name: 'x', description: null, config: weighted }))
    ).toMatchObject({
      ok: false,
      error: expect.stringMatching(/no evidence ruleset/)
    })
  })

  it('names the export file after the ranking', () => {
    expect(rankingFileName('My lab v2 / exome')).toBe('my-lab-v2-exome.ranking.json')
    expect(rankingFileName('***')).toBe('ranking.ranking.json')
  })
})
