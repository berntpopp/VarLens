import { describe, expect, it } from 'vitest'
import { buildScorers } from '../../../../scripts/shortlist-sim/sim/scorers'
import { VARVIS_EVIDENCE_TEMPLATE } from '../../../../src/shared/config/evidence-rulesets/varvis-template'
import { evidenceShortlistConfig } from '../../../../src/shared/evidence/evidence-shortlist-config'

describe('scorers', () => {
  it('benchmarks the product config: evidence_hand = evidenceShortlistConfig(template)', () => {
    const tuned = Array.from({ length: 5 }, () => VARVIS_EVIDENCE_TEMPLATE)
    const hand = buildScorers({ varvis: tuned }, []).find((s) => s.id === 'evidence_hand')!
    expect(hand.config(0)).toEqual(evidenceShortlistConfig(VARVIS_EVIDENCE_TEMPLATE))
    const cfg = hand.config(0)
    expect(cfg.rankConfig.clinvarPinTop).toBe(false)
    expect(cfg.rankConfig.pinStarredTop).toBe(false)
    expect(cfg.baseFilters).toEqual({
      maxGnomadAf: 0.01,
      consequences: ['HIGH', 'MODERATE', 'LOW']
    })
    expect(cfg.tieBreakers).toEqual([
      { key: 'cadd', order: 'desc' },
      { key: 'chr', order: 'asc' },
      { key: 'pos', order: 'asc' }
    ])
  })
})
