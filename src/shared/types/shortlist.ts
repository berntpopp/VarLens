/**
 * Shared shortlist types for the unified case Shortlist tab.
 *
 * These types power the two-stage candidate-generation + ranking pipeline
 * that backs `CaseView.vue`'s Shortlist tab. The contracts live here so
 * every wave (main service, IPC, renderer composable, components) imports
 * from a single source of truth.
 *
 * Spec: .planning/specs/2026-04-11-unified-shortlist-ranked-view-design.md
 * (§3, §4, §5, §6)
 */

import type { EvidenceContribution, EvidenceRuleset, ModeId } from './evidence-ruleset'
import type { Variant, SortItem } from './database'
import type { FilterState } from './filters'
import type { FilterPreset } from './filter-presets'

/** Every value `v-tabs` can hold in the case view. */
export type VisibleTab = 'shortlist' | 'snv' | 'sv' | 'cnv' | 'str'

/** Values that map to a real DB `variant_type` filter. Never includes `'shortlist'`. */
export type PerTypeTab = 'snv' | 'sv' | 'cnv' | 'str'

/**
 * The DB-level `variant_type` enum. Includes `'indel'`, which the UI folds
 * into the `'snv'` tab but which the shortlist pipeline must treat as a
 * first-class type when scoping per-type queries.
 */
export type VariantTypeKey = 'snv' | 'indel' | 'sv' | 'cnv' | 'str'

/**
 * Per-row contribution breakdown for the overall `rank_score`.
 * Exposed via `RankScoreTooltip.vue` so reviewers can audit *why* a row
 * ranked where it did. Values are the raw sub-scores in [0, 1] before
 * weighting.
 */
export interface RankComponents {
  impact: number
  pathogenicity: number
  rarity: number
  clinvar: number
  phenotype: number
}

/**
 * User-tunable weights for the five ranking sub-scores.
 *
 * Weights are clamped to [0, 100] at the IPC boundary via the Zod
 * schema, but the `combine()` step in `src/main/services/scoring/index.ts`
 * normalizes by the sum of the supplied weights — so fractions (0..1)
 * and percentages (0..100) produce identical rank scores. Built-in
 * presets use 0..1 fractions for consistency with the spec; ad-hoc
 * presets authored from the editor may use either scale interchangeably.
 */
export interface RankWeights {
  impact: number
  pathogenicity: number
  rarity: number
  clinvar: number
  phenotype: number
}

/**
 * Full ranking configuration — weights plus optional pinning rules that
 * promote specific rows to the top of the result regardless of their
 * computed `rank_score`.
 */
export interface RankConfig {
  weights: RankWeights
  /** When true, ClinVar P/LP rows are floated above all non-pinned rows. */
  clinvarPinTop?: boolean
  /** When true, starred rows (per-case or global) are floated above all non-pinned rows. */
  pinStarredTop?: boolean
  /** Evidence rules (spec §3.4); when set, rows are scored by the ruleset instead of `weights`. */
  ruleset?: EvidenceRuleset
}

/**
 * Stage-3 scoring columns added by the ranking pass. Combined with
 * `ShortlistCandidate` to produce `ScoredCandidate`, then `rank` is
 * appended to produce the final `ShortlistRow`.
 */
export interface ScoredRow {
  rank_score: number
  rank_components: RankComponents
  rank_clinvar_pinned: boolean
  rank_starred_pinned: boolean
  /** Evidence presets only: the inheritance-mode profile the row was scored under. */
  rank_mode?: ModeId
  /** Evidence presets only: mode and rule points; they sum to `rank_score`. */
  rank_evidence?: EvidenceContribution[]
  /** Evidence presets only: ids of the other het alleles of a possible compound het. */
  rank_partners?: number[]
}

/**
 * Stage-1 candidate row produced by the shortlist query helper.
 *
 * `ShortlistCandidate` extends `Variant` so every field of the existing
 * `Variant` interface is present with its existing name and type. This
 * makes `ShortlistCandidate` directly assignable to `Variant`, which is
 * REQUIRED for row-click drill-down to reuse
 * `CaseView.handleRowClick(variant: Variant)`.
 *
 * Extension columns are aliased `sv_` / `cnv_` / `str_` to flatten the
 * row shape. All extension fields are nullable because a given row
 * populates columns only for ITS variant type (e.g. an SNV row leaves
 * every `sv_*` / `cnv_*` / `str_*` field null).
 */
export interface ShortlistCandidate extends Variant {
  /** SV-only: 1 = precise breakpoints, 0 = imprecise (CI-based). */
  sv_is_precise?: 0 | 1 | null
  /** SV-only: variant allele fraction from SV caller. */
  sv_vaf?: number | null
  /** SV-only: supporting read count. */
  sv_support?: number | null
  /** CNV-only: estimated integer copy number. */
  cnv_copy_number?: number | null
  /** CNV-only: caller-reported quality for the copy-number estimate. */
  cnv_copy_number_quality?: number | null
  /** STR-only: expansion status vs disease thresholds. */
  str_status?: 'normal' | 'intermediate' | 'pathologic' | null
  /** STR-only: associated disease name, if known. */
  str_disease?: string | null
  /** STR-only: alternate allele copy count expression. */
  str_alt_copies?: string | null
  /** Derived from `COALESCE(cva.starred, 0)`; always present. */
  is_starred: boolean
}

/**
 * A candidate that has gone through the Stage-3 scoring pass. The
 * renderer can still treat it as a `Variant` / `ShortlistCandidate` for
 * drill-down purposes.
 */
export interface ScoredCandidate extends ShortlistCandidate, ScoredRow {}

/**
 * The final row shape emitted to the renderer — `ScoredCandidate` plus
 * its 1-based rank inside the Stage-4 `ORDER BY rank_score DESC …` result.
 */
export interface ShortlistRow extends ScoredCandidate {
  /** 1-based rank inside the final ordered result set. */
  rank: number
}

/**
 * Full shortlist configuration stored on presets with `kind === 'shortlist'`.
 *
 * `ShortlistConfig` is self-contained (it does not inherit from tab-level
 * filter state) — `baseFilters` is its own snapshot of the `FilterState`
 * surface it cares about. `perTypeOverrides` lets a preset relax or tighten
 * a specific variant type's filters without duplicating the base.
 */
export interface ShortlistConfig {
  /** Optional restriction: only query these variant types during Stage 1. */
  variantTypeScope?: VariantTypeKey[]
  /** Base filter snapshot applied to every variant-type query. */
  baseFilters: Partial<FilterState>
  /** Per-type overrides merged on top of `baseFilters` during Stage 1. */
  perTypeOverrides?: Partial<Record<VariantTypeKey, Partial<FilterState>>>
  /** Stage-4 hard cap on the number of ranked rows returned. Max 500. */
  topN: number
  /**
   * Append-only tie-breakers applied AFTER the primary `rank_score DESC`
   * sort. Capped at 10 entries by the Zod schema.
   */
  tieBreakers?: SortItem[]
  /** Scoring weights + optional pinning rules. */
  rankConfig: RankConfig
}

/**
 * Result envelope returned by the `variants:shortlist` IPC handler.
 *
 * `presetUsed` is populated when the request ran via `presetId`; it is
 * `null` for ad-hoc `adHocConfig` invocations.
 */
export interface ShortlistResult {
  rows: ShortlistRow[]
  /**
   * Number of eligible rows (all in-scope types) that were scored. Stage 1
   * pages through every row matching the filters — there is no topN-based
   * cap (#537) — so this equals the filter-match count of the scope.
   */
  totalCandidates: number
  presetUsed: FilterPreset | null
  elapsedMs: number
}
