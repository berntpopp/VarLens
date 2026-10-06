/**
 * Pure-TypeScript scoring module for the unified case shortlist.
 *
 * Exposes:
 *   - ZERO_COMPONENTS          — neutral components used on dispatch errors
 *   - mapConsequenceImpact     — VEP IMPACT (HIGH/MODERATE/LOW/MODIFIER) -> [0,1]
 *   - mapClinvarBoost          — ClinVar significance -> [0,1]
 *   - combine                  — weighted sum normalized over weight sum
 *   - scoreRow                 — per-type scorer dispatch + error handling
 *   - compareScoredRows        — partition ordering: starred > clinvar >
 *                                rank_score > tieBreakers > id
 *
 * No DB dependency. No I/O. Formula changes produce human-readable PR diffs
 * via inline snapshots in the per-scorer tests.
 *
 * **Every tunable numeric constant lives in `./scoring-config.ts`.** No
 * magic numbers anywhere else in this module. A tuning PR touches that
 * one file, not five.
 *
 * **Complete reference documentation:**
 * `.planning/docs/shortlist-scoring-heuristic.md` — every threshold,
 * every curve, every rationale. Single source of truth for the heuristic.
 *
 * Spec: .planning/specs/2026-04-11-unified-shortlist-ranked-view-design.md
 * (§4 score engine, §8 tests)
 */

import { mainLogger } from '../MainLogger'
import type {
  RankComponents,
  RankWeights,
  RankConfig,
  ScoredRow,
  ShortlistCandidate,
  ScoredCandidate
} from '../../../shared/types/shortlist'
import type { SortItem } from '../../../shared/types/database'
import { compareChromosomes } from '../../../shared/sql/chromosome-order'
import { SCORING_CONFIG } from './scoring-config'
import { scoreSnv } from './score-snv'
import { scoreSv } from './score-sv'
import { scoreCnv } from './score-cnv'
import { scoreStr } from './score-str'

export const ZERO_COMPONENTS: RankComponents = {
  impact: 0,
  pathogenicity: 0,
  rarity: 0,
  clinvar: 0,
  phenotype: 0
}

/**
 * Map a VEP IMPACT string to the `impact` sub-score in [0, 1]. Lookup
 * table lives in `scoring-config.ts` so the vocabulary and step values
 * stay in one place. Returns 0 for null or unknown strings.
 */
export function mapConsequenceImpact(consequence: string | null): number {
  return consequence == null ? 0 : (SCORING_CONFIG.consequenceImpact[consequence] ?? 0)
}

/**
 * Map a ClinVar significance string to the `clinvar` sub-score boost in
 * [0, 1]. Lookup table lives in `scoring-config.ts`. Returns 0 for null
 * or unknown strings.
 */
export function mapClinvarBoost(clinvar: string | null): number {
  return clinvar == null ? 0 : (SCORING_CONFIG.clinvarBoost[clinvar] ?? 0)
}

/**
 * Weighted combination of rank components. Always normalized over the sum
 * of weights, so the result is guaranteed to be in [0, 1] regardless of
 * the weight scale. Returns 0 defensively when all weights are zero.
 */
export function combine(components: RankComponents, weights: RankWeights): number {
  const weightSum =
    weights.impact + weights.pathogenicity + weights.rarity + weights.clinvar + weights.phenotype
  if (weightSum === 0) return 0
  const weighted =
    weights.impact * components.impact +
    weights.pathogenicity * components.pathogenicity +
    weights.rarity * components.rarity +
    weights.clinvar * components.clinvar +
    weights.phenotype * components.phenotype
  return weighted / weightSum
}

/**
 * Dispatch a candidate to the correct per-type scorer and assemble the
 * ScoredRow (rank_score + components + pin flags). Dispatch errors log
 * through mainLogger and fall back to ZERO_COMPONENTS so a single bad row
 * cannot crash the entire ranking pass.
 */
export function scoreRow(row: ShortlistCandidate, config: RankConfig): ScoredRow {
  let components: RankComponents
  try {
    switch (row.variant_type) {
      case 'snv':
      case 'indel':
        components = scoreSnv(row)
        break
      case 'sv':
        components = scoreSv(row)
        break
      case 'cnv':
        components = scoreCnv(row)
        break
      case 'str':
        components = scoreStr(row)
        break
      default:
        components = ZERO_COMPONENTS
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    mainLogger.error(
      `scoreRow failed for variant_type=${String(row.variant_type)} id=${row.id}: ${message}`,
      'shortlist.scoreRow'
    )
    components = ZERO_COMPONENTS
  }
  return {
    rank_score: combine(components, config.weights),
    rank_components: components,
    rank_clinvar_pinned: config.clinvarPinTop === true && components.clinvar >= 0.9,
    rank_starred_pinned: config.pinStarredTop === true && row.is_starred === true
  }
}

function compareByKey(a: ScoredCandidate, b: ScoredCandidate, key: string): number {
  const av = (a as unknown as Record<string, unknown>)[key]
  const bv = (b as unknown as Record<string, unknown>)[key]
  if (av == null && bv == null) return 0
  if (av == null) return 1
  if (bv == null) return -1
  if (typeof av === 'number' && typeof bv === 'number') return av - bv
  // Natural chromosome order (1..22, X, Y, MT, then others) — same as the SQL sinks.
  if (key === 'chr') return compareChromosomes(String(av), String(bv))
  return String(av).localeCompare(String(bv))
}

/**
 * Total ordering for scored rows. Partitions in spec-mandated order:
 *   1. starred-pinned first
 *   2. clinvar-pinned next
 *   3. rank_score DESC
 *   4. caller-supplied tieBreakers
 *   5. id ASC (stable fallback)
 *
 * Returns negative if `a` should sort before `b`.
 */
export function compareScoredRows(
  a: ScoredCandidate,
  b: ScoredCandidate,
  tieBreakers?: SortItem[]
): number {
  if (a.rank_starred_pinned !== b.rank_starred_pinned) {
    return a.rank_starred_pinned ? -1 : 1
  }
  if (a.rank_clinvar_pinned !== b.rank_clinvar_pinned) {
    return a.rank_clinvar_pinned ? -1 : 1
  }
  if (a.rank_score !== b.rank_score) return b.rank_score - a.rank_score
  if (tieBreakers != null) {
    for (const tb of tieBreakers) {
      const cmp = compareByKey(a, b, tb.key)
      if (cmp !== 0) return tb.order === 'desc' ? -cmp : cmp
    }
  }
  return a.id - b.id
}
