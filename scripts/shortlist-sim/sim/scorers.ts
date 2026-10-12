/**
 * Compared scorers (spec §5.3), all as ad-hoc shortlist configs on the production API.
 *
 * - `tier1`, `all_rare_damaging`: the built-in presets verbatim.
 * - `cadd_desc`: legacy scorer with weights {pathogenicity: 1} (= min(CADD/40, 1)); ties at the
 *   saturation ceiling are broken by the `cadd desc` tie-breaker, so the order is CADD descending,
 *   missing CADD last. Evidence gate.
 * - `af_asc`: legacy scorer with weights {rarity: 1} (= 1 − AF/0.01, missing AF → the null
 *   default); strictly decreasing in AF, so the order is AF ascending. Evidence gate.
 * - `evidence_hand`: the frozen varvis template with its hand-set points; `evidence_tuned`: the
 *   template with the fold's tuned points. Disabled groups (§11.4) score 0 in both.
 * - Ablations of `evidence_tuned` per group and per mode (points zeroed), primary scenario only.
 * - Same-gate pairs: Tier 1 scoring under the evidence gate, tuned scoring under Tier 1's gate.
 */
import { BUILT_IN_SHORTLIST_PRESETS } from '../../../src/main/database/built-in-shortlist-presets'
import { SHORTLIST_EVIDENCE_CONFIG } from '../../../src/shared/config/shortlist-evidence.config'
import { VARVIS_EVIDENCE_TEMPLATE } from '../../../src/shared/config/evidence-rulesets/varvis-template'
import type { EvidenceRuleset, ModeId } from '../../../src/shared/types/evidence-ruleset'
import type { RankWeights, ShortlistConfig } from '../../../src/shared/types/shortlist'
import type { ScenarioId } from '../common/types'

export interface ScorerDef {
  id: string
  label: string
  config: (fold: number) => ShortlistConfig
  /** Scenarios the scorer runs in; ablations run in the primary scenario only. */
  scenarios: 'all' | ScenarioId[]
}

const ZERO: RankWeights = { impact: 0, pathogenicity: 0, rarity: 0, clinvar: 0, phenotype: 0 }
const TIE_BREAKERS: ShortlistConfig['tieBreakers'] = [
  { key: 'cadd', order: 'desc' },
  { key: 'chr', order: 'asc' },
  { key: 'pos', order: 'asc' }
]
const gate = SHORTLIST_EVIDENCE_CONFIG.defaultGate
export const EVIDENCE_GATE: ShortlistConfig['baseFilters'] = {
  maxGnomadAf: gate.maxGnomadAf,
  consequences: [...gate.consequences]
}

const builtIn = (name: string): ShortlistConfig => {
  const preset = BUILT_IN_SHORTLIST_PRESETS.find((p) => p.name === name)
  if (preset === undefined) throw new Error(`built-in preset ${name} missing`)
  return structuredClone(preset.config) as ShortlistConfig
}

export function evidenceConfig(
  ruleset: EvidenceRuleset,
  baseFilters: ShortlistConfig['baseFilters'] = EVIDENCE_GATE
): ShortlistConfig {
  return {
    variantTypeScope: [...SHORTLIST_EVIDENCE_CONFIG.variantTypes],
    topN: SHORTLIST_EVIDENCE_CONFIG.defaultTopN,
    baseFilters,
    rankConfig: { weights: ZERO, ruleset, clinvarPinTop: false, pinStarredTop: false },
    tieBreakers: TIE_BREAKERS
  }
}

const legacy = (weights: Partial<RankWeights>): ShortlistConfig => ({
  variantTypeScope: ['snv', 'indel'],
  topN: 100,
  baseFilters: EVIDENCE_GATE,
  rankConfig: { weights: { ...ZERO, ...weights }, clinvarPinTop: false, pinStarredTop: false },
  tieBreakers: TIE_BREAKERS
})

/** A copy with every rule of the named groups at 0 points. */
export function zeroGroups(rs: EvidenceRuleset, groupIds: readonly string[]): EvidenceRuleset {
  return {
    ...rs,
    groups: rs.groups.map((g) =>
      groupIds.includes(g.id) ? { ...g, rules: g.rules.map((r) => ({ ...r, points: 0 })) } : g
    )
  }
}

export function zeroModes(rs: EvidenceRuleset, modeIds: readonly ModeId[]): EvidenceRuleset {
  return {
    ...rs,
    modes: rs.modes.map((m) => (modeIds.includes(m.id) ? { ...m, points: 0 } : m))
  }
}

export const REFERENCE_SCORER = 'tier1'
export const CANDIDATE_SCORER = 'evidence_tuned'

/** All scorers; `tuned[fold]` is the fold's tuned ruleset (disabled groups already zeroed). */
export function buildScorers(
  tuned: readonly EvidenceRuleset[],
  disabledGroups: string[]
): ScorerDef[] {
  const tier1 = builtIn('Tier 1 candidates')
  const hand = zeroGroups(VARVIS_EVIDENCE_TEMPLATE, disabledGroups)
  const fixed = (c: ShortlistConfig) => (): ShortlistConfig => c
  const all = 'all' as const
  const primary: ScenarioId[] = ['primary']
  const scorers: ScorerDef[] = [
    { id: 'tier1', label: 'Tier 1 candidates', config: fixed(tier1), scenarios: all },
    {
      id: 'all_rare_damaging',
      label: 'All rare damaging',
      config: fixed(builtIn('All rare damaging')),
      scenarios: all
    },
    {
      id: 'cadd_desc',
      label: 'CADD descending',
      config: fixed(legacy({ pathogenicity: 1 })),
      scenarios: all
    },
    { id: 'af_asc', label: 'AF ascending', config: fixed(legacy({ rarity: 1 })), scenarios: all },
    {
      id: 'evidence_hand',
      label: 'Evidence, hand-set points',
      config: fixed(evidenceConfig(hand)),
      scenarios: all
    },
    {
      id: CANDIDATE_SCORER,
      label: 'Evidence, tuned points',
      config: (f) => evidenceConfig(tuned[f]),
      scenarios: all
    },
    {
      id: 'tier1_evgate',
      label: 'Tier 1 scoring, evidence gate',
      config: fixed({ ...tier1, variantTypeScope: ['snv', 'indel'], baseFilters: EVIDENCE_GATE }),
      scenarios: all
    },
    {
      id: 'tuned_t1gate',
      label: 'Tuned evidence, Tier 1 gate',
      config: (f) => evidenceConfig(tuned[f], structuredClone(tier1.baseFilters)),
      scenarios: all
    }
  ]
  for (const g of VARVIS_EVIDENCE_TEMPLATE.groups) {
    if (disabledGroups.includes(g.id)) continue
    scorers.push({
      id: `abl_group_${g.id}`,
      label: `Tuned without ${g.label}`,
      config: (f) => evidenceConfig(zeroGroups(tuned[f], [g.id])),
      scenarios: primary
    })
  }
  const modeIds = VARVIS_EVIDENCE_TEMPLATE.modes.map((m) => m.id).filter((m) => m !== 'fallback')
  for (const m of modeIds) {
    scorers.push({
      id: `abl_mode_${m}`,
      label: `Tuned without mode ${m}`,
      config: (f) => evidenceConfig(zeroModes(tuned[f], [m])),
      scenarios: primary
    })
  }
  scorers.push({
    id: 'abl_modes_all',
    label: 'Tuned without inheritance modes',
    config: (f) => evidenceConfig(zeroModes(tuned[f], modeIds)),
    scenarios: primary
  })
  return scorers
}

export const runsIn = (s: ScorerDef, scenario: ScenarioId): boolean =>
  s.scenarios === 'all' || s.scenarios.includes(scenario)
