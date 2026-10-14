import { describe, expect, it } from 'vitest'
import { GeneContextBuilder } from '../../../../../src/main/services/scoring/evidence'
import {
  getCompiledRuleset,
  scoreEvidencePage,
  toLightRow,
  withHpoExplanations
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

  it('rules can use the in-app hpo_resnik; it is null without HPO data (#600)', () => {
    const ruleset = structuredClone(EVIDENCE_RULESET)
    ruleset.groups.push({
      id: 'pheno',
      label: 'Phenotype',
      scope: 'global',
      rules: [{ id: 'resnik', label: 'Resnik ≥ 2', when: 'hpo_resnik:>=:2', points: 7 }]
    })
    const rows = [
      candidate({ id: 1, chr: '1', pos: 1, ref: 'A', alt: 'G', gene_symbol: 'FIT', gt_num: '0/1' }),
      candidate({ id: 2, chr: '1', pos: 2, ref: 'A', alt: 'G', gene_symbol: 'MISS', gt_num: '0/1' })
    ]
    const rank = { weights: { impact: 1, pathogenicity: 1, rarity: 1, clinvar: 1, phenotype: 0 } }
    const score = (info: Parameters<typeof GeneContextBuilder>[0]) => {
      const builder = new GeneContextBuilder(info)
      builder.add(rows.map(toLightRow))
      return scoreEvidencePage(rows, builder.build(), getCompiledRuleset(ruleset), rank)
    }
    const hpo = {
      score: (gene: string): number | null => (gene === 'FIT' ? 2.5 : 0.4),
      bestDisease: (): string | null => 'OMIM:1',
      conflicts: (): number | null => 0,
      explain: () => null
    }
    const withHpo = score({ build: 'GRCh38', sex: null, hpo })
    expect(withHpo.map((r) => r.rank_evidence?.some((c) => c.id === 'resnik'))).toEqual([
      true,
      false
    ])
    const without = score({ build: 'GRCh38', sex: null })
    expect(without.every((r) => r.rank_evidence?.every((c) => c.id !== 'resnik'))).toBe(true)
  })

  it('exposes hpo_best_disease / hpo_conflicts to rules and explains only the returned rows', () => {
    const ruleset = structuredClone(EVIDENCE_RULESET)
    ruleset.groups.push({
      id: 'pheno',
      label: 'Phenotype',
      scope: 'global',
      rules: [
        { id: 'conflict', label: 'Conflict', when: 'hpo_conflicts:>=:1', points: -3 },
        { id: 'dravet', label: 'Dravet', when: 'hpo_best_disease:=:"ORPHA:33069"', points: 5 }
      ]
    })
    const rows = [
      candidate({
        id: 1,
        chr: '1',
        pos: 1,
        ref: 'A',
        alt: 'G',
        gene_symbol: 'SCN1A',
        gt_num: '0/1'
      }),
      candidate({
        id: 2,
        chr: '1',
        pos: 2,
        ref: 'A',
        alt: 'G',
        gene_symbol: 'KCNT1',
        gt_num: '0/1'
      })
    ]
    const explanation = {
      score: 0.6,
      percentile: 0.99,
      diseaseId: 'ORPHA:33069',
      diseaseLabel: 'Dravet syndrome',
      matched: [],
      conflicts: [],
      notConflicts: []
    }
    const explained: string[] = []
    const hpo = {
      score: (): number | null => 0.6,
      bestDisease: (gene: string): string | null => (gene === 'SCN1A' ? 'ORPHA:33069' : 'ORPHA:1'),
      conflicts: (gene: string): number | null => (gene === 'KCNT1' ? 1 : 0),
      explain: (gene: string) => (explained.push(gene), explanation)
    }
    const builder = new GeneContextBuilder({ build: 'GRCh38', sex: null, hpo })
    builder.add(rows.map(toLightRow))
    const rank = { weights: { impact: 1, pathogenicity: 1, rarity: 1, clinvar: 1, phenotype: 0 } }
    const scored = scoreEvidencePage(rows, builder.build(), getCompiledRuleset(ruleset), rank)
    expect(scored.map((r) => r.rank_evidence?.find((c) => c.group === 'pheno')?.id)).toEqual([
      'dravet',
      'conflict'
    ])
    expect(explained).toEqual([])
    const kept = withHpoExplanations(scored.slice(0, 1), { build: 'GRCh38', sex: null, hpo })
    expect(kept[0].rank_hpo).toBe(explanation)
    expect(explained).toEqual(['SCN1A'])
    expect(withHpoExplanations(scored, { build: 'GRCh38', sex: null })[0].rank_hpo).toBeUndefined()
  })
})
