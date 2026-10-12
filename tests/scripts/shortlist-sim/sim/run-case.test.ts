import { afterAll, describe, expect, it } from 'vitest'
import { rng } from '../../../../scripts/shortlist-sim/common/rng'
import {
  openBackgroundDb,
  describeBackground,
  variantCount
} from '../../../../scripts/shortlist-sim/sim/background-db'
import { buildCases } from '../../../../scripts/shortlist-sim/sim/cases'
import {
  alleleRank,
  rankAll,
  runCase,
  withSpikes
} from '../../../../scripts/shortlist-sim/sim/run-case'
import { buildScorers, evidenceConfig } from '../../../../scripts/shortlist-sim/sim/scorers'
import type { SpikeSource } from '../../../../scripts/shortlist-sim/sim/spikes'
import { VARVIS_EVIDENCE_TEMPLATE } from '../../../../src/shared/config/evidence-rulesets/varvis-template'
import type { ShortlistRow } from '../../../../src/shared/types/shortlist'
import { GENES, poolSpike, SPIKE_OPTIONS, syntheticBackground } from './fixtures'

const bg = syntheticBackground()
const db = openBackgroundDb(bg, 'primary', 1)
afterAll(() => db.db.close())

const sources = new Map<string, SpikeSource>()
const add = (s: SpikeSource): void => void sources.set(s.pv.key, s)
add(poolSpike('GENE0', { moi: 'AR', diseaseIds: ['OMIM:9'] }))
add(poolSpike('GENE0', { moi: 'AR', diseaseIds: ['OMIM:9'] }))
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
const comphet = cases.find((c) => c.mode === 'AR_COMPHET')!
const tuned = Array.from({ length: 5 }, () => VARVIS_EVIDENCE_TEMPLATE)

describe('runCase', () => {
  it('ranks causal alleles with integer ranks and rolls the spikes back', () => {
    const before = variantCount(db)
    const results = runCase(db, comphet, buildScorers(tuned, []), 0, rng(1))
    expect(variantCount(db)).toBe(before)
    const ev = results.find((r) => r.scorer === 'evidence_hand')!
    expect(ev.alleles).toHaveLength(2)
    for (const a of ev.alleles) expect(Number.isInteger(a.rank)).toBe(true)
    expect(ev.causalEligible).toEqual([true, true])
    expect(ev.eligible).toBeGreaterThan(0)
    expect(results.some((r) => r.scorer === 'abl_group_freq')).toBe(true) // primary runs ablations
  })

  it('complete production order: top 50 equals getShortlist for the same config', () => {
    const config = evidenceConfig(VARVIS_EVIDENCE_TEMPLATE)
    withSpikes(db, comphet, rng(2), () => {
      const all = rankAll(db, config).rows
      const top = db.repos.shortlistService.getShortlist(
        { caseId: db.caseId, adHocConfig: { ...config, topN: 50 } },
        () => null
      ).rows
      expect(all.slice(0, 50).map((r) => r.id)).toEqual(top.map((r) => r.id))
      // both alleles score as possible compound hets
      const modes = all
        .filter((r) => r.gene_symbol === comphet.gene && r.rank_partners?.length)
        .map((r) => r.rank_mode)
      expect(modes).toContain('ar_comphet')
    })
  })
})

describe('alleleRank', () => {
  const row = (id: number, score: number, pin = false): ShortlistRow =>
    ({
      id,
      rank: 0,
      rank_score: score,
      rank_clinvar_pinned: pin,
      rank_starred_pinned: false
    }) as ShortlistRow
  const rows = [row(1, 1, true), row(2, 9), row(3, 5), row(4, 5), row(5, 5), row(6, 2)].map(
    (r, i) => ({ ...r, rank: i + 1 })
  )

  it('counts earlier partitions and higher scores as higher, same score as equal', () => {
    expect(alleleRank(rows, 4)).toEqual({ rank: 4, higher: 2, equal: 2 })
    expect(alleleRank(rows, 1)).toEqual({ rank: 1, higher: 0, equal: 0 })
    expect(alleleRank(rows, 6)).toEqual({ rank: 6, higher: 5, equal: 0 })
    expect(alleleRank(rows, 99)).toEqual({ rank: null, higher: 0, equal: 0 })
  })
})
