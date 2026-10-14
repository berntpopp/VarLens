import { describe, expect, it, vi } from 'vitest'
import {
  RESNIK_HAND_POINTS,
  resnikGroup
} from '../../../../scripts/shortlist-sim/phenotype/resnik-group'
import { describeBackground } from '../../../../scripts/shortlist-sim/sim/background-db'
import { buildCases } from '../../../../scripts/shortlist-sim/sim/cases'
import { JobRunner, type JobResult } from '../../../../scripts/shortlist-sim/sim/jobs'
import { evidenceConfig } from '../../../../scripts/shortlist-sim/sim/scorers'
import type { SpikeSource } from '../../../../scripts/shortlist-sim/sim/spikes'
import { openHpoGeneScorer } from '../../../../src/main/services/phenotype/hpo-similarity-db'
import { VARVIS_EVIDENCE_TEMPLATE } from '../../../../src/shared/config/evidence-rulesets/varvis-template'
import { GENES, poolSpike, SPIKE_OPTIONS, syntheticBackground } from './fixtures'

// Synthetic scorer: the causal gene scores high only under the matching profile.
vi.mock('../../../../src/main/services/phenotype/hpo-similarity-db', async (original) => ({
  ...(await original<object>()),
  openHpoGeneScorer: vi.fn((terms: string[]) =>
    terms.length === 0
      ? null
      : { score: (g: string) => (terms.includes('HP:MATCH') && g === 'GENE1' ? 5 : null) }
  )
}))

const bg = syntheticBackground()
const sources = new Map<string, SpikeSource>()
const add = (s: SpikeSource): void => void sources.set(s.pv.key, s)
add(poolSpike('GENE1', { moi: 'AD' }))
for (let i = 0; i < 12; i++)
  add(poolSpike(GENES[5 + i], { label: 'benign', moi: null }, 'missense_variant', 0.001))
const { cases } = buildCases(
  [...sources.values()].map((s) => s.pv),
  sources,
  [{ info: describeBackground('bg1', bg.rows), normKeys: new Set() }],
  3,
  SPIKE_OPTIONS
)
const c = cases.find((x) => x.gene === 'GENE1')!

describe('pheno job', () => {
  it('writes each profile as case HPO terms for the ranking and rolls them back', () => {
    const runner = new JobRunner({
      backgrounds: [bg],
      seed: 1,
      disabledGroups: [],
      template: 'varvis'
    })
    const withResnik = {
      ...VARVIS_EVIDENCE_TEMPLATE,
      groups: [...VARVIS_EVIDENCE_TEMPLATE.groups, resnikGroup(RESNIK_HAND_POINTS)]
    }
    const r = runner.run({
      kind: 'pheno',
      bg: 'bg1',
      scenario: 'primary',
      cases: [c],
      folds: [0],
      profiles: [{ match: ['HP:MATCH', 'HP:0000001'], other: ['HP:OTHER'] }],
      fixed: [{ a: evidenceConfig(VARVIS_EVIDENCE_TEMPLATE) }],
      perProfile: [{ c: evidenceConfig(withResnik) }]
    }) as Extract<JobResult, { kind: 'eval' }>

    expect(r.results.map((x) => x.scorer)).toEqual(['a', 'c:match', 'c:other'])
    const calls = vi.mocked(openHpoGeneScorer).mock.calls.map(([t]) => [...t].sort())
    expect(calls).toEqual([['HP:0000001', 'HP:MATCH'], ['HP:OTHER']])
    const rank = (id: string): number => r.results.find((x) => x.scorer === id)!.alleles[0].rank!
    expect(rank('c:match')).toBeLessThan(rank('c:other'))
    const db = runner['current']!
    expect(db.repos.metadata.getCaseHpoTerms(db.caseId)).toEqual([])
    db.db.close()
  })
})
