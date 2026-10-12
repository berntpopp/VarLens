import { describe, expect, it } from 'vitest'
import { GeneContextBuilder } from '../../../../../src/main/services/scoring/evidence'
import {
  getCompiledRuleset,
  scoreEvidencePage,
  toLightRow
} from '../../../../../src/main/services/scoring/evidence/rank-page'
import type { ShortlistCandidate } from '../../../../../src/shared/types/shortlist'
import { makeVariant } from '../../../../utils/make-variant'
import { EVIDENCE_RULESET } from '../../../../fixtures/shortlist/evidence-fixture'

const candidate = (o: Partial<ShortlistCandidate>): ShortlistCandidate =>
  ({ ...makeVariant(o), is_starred: false, ...o }) as ShortlistCandidate

describe('rank-page', () => {
  it('memoises compilation by ruleset content', () => {
    const a = getCompiledRuleset(EVIDENCE_RULESET)
    expect(getCompiledRuleset(structuredClone(EVIDENCE_RULESET))).toBe(a)
  })

  it('scores a page with partners, pins and exact contributions', () => {
    const rows = [
      candidate({
        id: 1,
        chr: '2',
        pos: 10,
        ref: 'A',
        alt: 'G',
        gene_symbol: 'G',
        moi: 'AR',
        gt_num: '0/1',
        gnomad_af: null
      }),
      candidate({
        id: 2,
        chr: '2',
        pos: 20,
        ref: 'C',
        alt: 'T',
        gene_symbol: 'G',
        moi: 'AR',
        gt_num: '0/1',
        gnomad_af: null,
        clinvar: 'Pathogenic',
        is_starred: true
      })
    ]
    const builder = new GeneContextBuilder({ build: 'GRCh38', sex: null })
    builder.add(rows.map(toLightRow))
    const scored = scoreEvidencePage(rows, builder.build(), getCompiledRuleset(EVIDENCE_RULESET), {
      weights: { impact: 1, pathogenicity: 1, rarity: 1, clinvar: 1, phenotype: 0 },
      clinvarPinTop: true,
      pinStarredTop: true
    })
    expect(scored.map((r) => r.rank_partners)).toEqual([[2], [1]])
    expect(scored.map((r) => r.rank_mode)).toEqual(['ar_comphet', 'ar_comphet'])
    expect(scored[1]).toMatchObject({ rank_clinvar_pinned: true, rank_starred_pinned: true })
    expect(scored[0]).toMatchObject({ rank_clinvar_pinned: false, rank_starred_pinned: false })
    for (const r of scored) {
      expect(r.rank_evidence?.reduce((s, c) => s + c.points, 0)).toBe(r.rank_score)
    }
  })
})
