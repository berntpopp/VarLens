import { describe, expect, it } from 'vitest'
import { estimatePoints } from '../../../../scripts/shortlist-sim/stats/points'
import { tuneRuleset, type Assignment } from '../../../../scripts/shortlist-sim/stats/tune'
import type { ScenarioId } from '../../../../scripts/shortlist-sim/common/types'
import type { ModeId } from '../../../../src/shared/types/evidence-ruleset'
import { VARVIS_EVIDENCE_TEMPLATE } from '../../../../src/shared/config/evidence-rulesets/varvis-template'

const many = (
  n: number,
  gene: string,
  mode: ModeId,
  bins: Record<string, string>,
  scenario: ScenarioId = 'primary'
): Assignment[] => Array.from({ length: n }, () => ({ gene, mode, bins, scenario }))

// Positives: 30 LoF + 70 other; background: 10 LoF + 990 other (gene T is a test gene, ignored).
const positives = [
  ...many(30, 'A', 'ad', { effect: 'lof', freq: 'af_missing', ad_freq: 'ad_af_ref' }),
  ...many(70, 'A', 'fallback', { effect: 'effect_ref', freq: 'af_ref' }),
  ...many(500, 'T', 'ad', { effect: 'lof' }),
  ...many(40, 'A', 'fallback', { clinvar: 'clinvar_plp' }, 'clinvar_visible'),
  ...many(60, 'A', 'fallback', { clinvar: 'clinvar_ref' }, 'clinvar_visible')
]
const background = [
  ...many(10, 'B', 'ad', { effect: 'lof', freq: 'af_ref', ad_freq: 'ad_af_high' }),
  ...many(990, 'B', 'fallback', { effect: 'effect_ref', freq: 'af_ref' }),
  ...many(5000, 'T', 'fallback', { effect: 'effect_ref' }),
  ...many(10, 'B', 'fallback', { clinvar: 'clinvar_plp' }, 'clinvar_visible'),
  ...many(990, 'B', 'fallback', { clinvar: 'clinvar_ref' }, 'clinvar_visible')
]
const training = (g: string): boolean => g !== 'T'
const tune = (disabled: string[] = []) =>
  tuneRuleset(VARVIS_EVIDENCE_TEMPLATE, { positives, background }, training, disabled, { id: 't' })
const pts = (r: ReturnType<typeof tune>, group: string, bin: string) =>
  r.support.find((s) => s.group === group && s.bin === bin)!

describe('tuneRuleset (spec §11.1)', () => {
  it('estimates points from first-match counts of training genes only', () => {
    const r = tune()
    const effectBins = VARVIS_EVIDENCE_TEMPLATE.groups
      .find((g) => g.id === 'effect')!
      .rules.map((rule) => ({
        id: rule.id,
        a: rule.id === 'lof' ? 30 : rule.id === 'effect_ref' ? 70 : 0,
        b: rule.id === 'lof' ? 10 : rule.id === 'effect_ref' ? 990 : 0,
        isReference: rule.id === 'effect_ref'
      }))
    const want = estimatePoints(effectBins, 100, 1000).find((p) => p.id === 'lof')!
    expect(pts(r, 'effect', 'lof')).toMatchObject({ a: 30, b: 10, points: want.points })
    expect(want.points).toBeGreaterThan(0)
    expect(r.A).toBe(100)
    expect(r.B).toBe(1000)
    expect(
      r.ruleset.groups.find((g) => g.id === 'effect')!.rules.find((x) => x.id === 'lof')!.points
    ).toBe(want.points)
  })

  it('tunes ClinVar on clinvar_visible and mode-scoped groups within their mode', () => {
    const r = tune()
    expect(pts(r, 'clinvar', 'clinvar_plp')).toMatchObject({ a: 40, b: 10 })
    expect(pts(r, 'ad_freq', 'ad_af_ref')).toMatchObject({ a: 30, b: 0 })
    expect(pts(r, 'ad_freq', 'ad_af_high')).toMatchObject({ a: 0, b: 10 })
    expect(pts(r, 'modes', 'ad')).toMatchObject({ a: 30, b: 10 })
    expect(pts(r, 'modes', 'fallback')).toMatchObject({ a: 70, b: 990, points: 0 })
  })

  it('anchors each group at its best-supported bin; thin groups and disabled groups score 0', () => {
    const r = tune()
    // ad_freq: anchor = ad_af_ref (a 30); the too-common bin gets a penalty, not a forced 0.
    expect(pts(r, 'ad_freq', 'ad_af_ref')).toMatchObject({ isAnchor: true, points: 0 })
    expect(pts(r, 'ad_freq', 'ad_af_high').points).toBeLessThan(0)
    // phenotype: no training positives (A < 20) → 0 throughout.
    expect(pts(r, 'phenotype', 'hpo_15')).toMatchObject({ supported: false, points: 0 })
    const off = tune(['effect'])
    expect(pts(off, 'effect', 'lof').points).toBe(0)
    expect(
      off.ruleset.groups.find((g) => g.id === 'effect')!.rules.every((x) => x.points === 0)
    ).toBe(true)
  })

  it('bootstrap intervals bracket the estimate and are deterministic', () => {
    const run = () =>
      tuneRuleset(VARVIS_EVIDENCE_TEMPLATE, { positives, background }, training, [], {
        id: 't',
        bootstrap: { reps: 50, seed: 3 }
      })
    const a = pts(run(), 'effect', 'lof')
    expect(a.lo).toEqual(pts(run(), 'effect', 'lof').lo)
    expect(a.lo! <= a.hi!).toBe(true)
  })
})
