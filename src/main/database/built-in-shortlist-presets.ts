/**
 * Built-in shortlist presets seeded by migration v27.
 *
 * Each preset defines a `ShortlistConfig` that drives the two-stage
 * candidate-generation + ranking pipeline backing the unified case
 * Shortlist tab. The `config.rankConfig.weights` feed the scoring
 * module's `combine()` step; `clinvarPinTop` / `pinStarredTop` pin
 * classes of rows above the score-driven ordering.
 *
 * `baseFilters` / `perTypeOverrides` are a `FilterState` snapshot. The
 * Stage-1 shortlist query maps it to the case-view `VariantFilter`
 * (`toShortlistVariantFilter`) and runs it through the same filter pipeline
 * as the variant table on both backends, so every case-view filter —
 * including `inheritanceModes`, `activePanelIds`, `searchQuery` and
 * `starredOnly` — restricts the shortlist.
 *
 * The seeded "Recessive candidates" preset predates that (inheritance modes
 * used to be ignored on SQLite) and gates on `consequences` + `maxGnomadAf`
 * plus a narrower `variantTypeScope` only. Its stored definition is left
 * unchanged: adding an inheritance filter to it would alter the results of a
 * preset users already rely on.
 *
 * Spec: .planning/specs/2026-04-11-unified-shortlist-ranked-view-design.md
 * (§5 built-in presets)
 */

import type { ShortlistConfig } from '../../shared/types/shortlist'

export interface BuiltInShortlistPreset {
  name: string
  description: string
  sortOrder: number
  config: ShortlistConfig
}

export const BUILT_IN_SHORTLIST_PRESETS: readonly BuiltInShortlistPreset[] = [
  {
    name: 'Tier 1 candidates',
    description:
      'Strict ranking: rare HIGH/MOD impact, top-50. ClinVar P/LP and starred variants pinned to top.',
    sortOrder: 0,
    config: {
      variantTypeScope: ['snv', 'indel', 'sv', 'cnv', 'str'],
      topN: 50,
      baseFilters: {
        // Intentionally NO `clinvars` hard filter — the preset RANKS via
        // clinvarPinTop, it does not gate on ClinVar. A rare HIGH SNV with
        // no ClinVar entry is still a Tier 1 candidate.
        consequences: ['HIGH', 'MODERATE'],
        maxGnomadAf: 0.001
      },
      perTypeOverrides: {
        sv: { maxGnomadAf: 0.01 },
        cnv: { maxGnomadAf: 0.01 },
        str: {}
      },
      rankConfig: {
        weights: { impact: 0.25, pathogenicity: 0.25, rarity: 0.25, clinvar: 0.25, phenotype: 0 },
        clinvarPinTop: true,
        pinStarredTop: true
      },
      tieBreakers: [
        { key: 'cadd', order: 'desc' },
        { key: 'chr', order: 'asc' },
        { key: 'pos', order: 'asc' }
      ]
    }
  },
  {
    name: 'All rare damaging',
    description: 'Broad shortlist: any rare HIGH/MOD variant. Score-driven ordering, no pins.',
    sortOrder: 1,
    config: {
      variantTypeScope: ['snv', 'indel', 'sv', 'cnv', 'str'],
      topN: 200,
      baseFilters: {
        consequences: ['HIGH', 'MODERATE'],
        maxGnomadAf: 0.01,
        minCadd: 15
      },
      rankConfig: {
        weights: { impact: 0.4, pathogenicity: 0.3, rarity: 0.3, clinvar: 0, phenotype: 0 },
        clinvarPinTop: false,
        pinStarredTop: false
      },
      tieBreakers: [{ key: 'cadd', order: 'desc' }]
    }
  },
  {
    name: 'Recessive candidates',
    description:
      'SNV/indel only. Rare coding impact — use the per-tab Inheritance filter for homozygous / compound-het narrowing.',
    sortOrder: 2,
    // NOTE: This preset intentionally does NOT set `inheritanceModes`.
    // The Stage-1 shortlist query does not yet forward inheritance-mode
    // filtering (see built-in-shortlist-presets.ts module JSDoc for the
    // full rationale). Setting the field would be silently ignored and
    // return every rare HIGH/MOD row — misleading for clinical users.
    // Until the follow-up wave plumbs inheritance through the raw-SQL
    // path, the preset ships as a rare-damaging SNV/indel filter and
    // users narrow by inheritance via the per-tab filter toolbar.
    config: {
      variantTypeScope: ['snv', 'indel'],
      topN: 100,
      baseFilters: {
        consequences: ['HIGH', 'MODERATE'],
        maxGnomadAf: 0.02
      },
      rankConfig: {
        weights: { impact: 0.3, pathogenicity: 0.2, rarity: 0.3, clinvar: 0.2, phenotype: 0 },
        clinvarPinTop: false,
        pinStarredTop: false
      },
      tieBreakers: [
        { key: 'gene_symbol', order: 'asc' },
        { key: 'cadd', order: 'desc' }
      ]
    }
  }
] as const
