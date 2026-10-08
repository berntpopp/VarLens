/**
 * Built-in filter presets shipped with VarLens.
 *
 * These are seeded into the filter_presets table on migration v15 (v45 adds "Rare, not recurrent" to existing databases).
 * Users can hide them but not delete them. The filter_json stores
 * a Partial<FilterState> object matching the shared FilterState type.
 *
 * Presets are designed as clinically meaningful combinations:
 * - Combo presets (frequency + impact/pathogenicity) for common workflows
 * - Single-dimension presets for flexible mix-and-match
 */

import type { FilterState } from '../../shared/types/filters'

interface BuiltInPresetDef {
  name: string
  description: string
  filterJson: Partial<FilterState>
  sortOrder: number
}

const CLINVAR_PATHOGENIC = ['Pathogenic', 'Likely_pathogenic', 'Pathogenic/Likely_pathogenic']

/** Added by SQLite v45 / PostgreSQL 0028 (#455). */
export const RARE_NOT_RECURRENT_PRESET_NAME = 'Rare, not recurrent'

export const BUILT_IN_PRESETS: readonly BuiltInPresetDef[] = [
  // ── Combo presets (common clinical workflows) ──
  {
    name: 'Rare Pathogenic',
    description: 'gnomAD AF <= 1% + ClinVar P/LP',
    filterJson: { maxGnomadAf: 0.01, clinvars: CLINVAR_PATHOGENIC },
    sortOrder: 0
  },
  {
    name: 'Rare HIGH',
    description: 'gnomAD AF <= 1% + HIGH impact',
    filterJson: { maxGnomadAf: 0.01, consequences: ['HIGH'] },
    sortOrder: 1
  },
  {
    name: 'Rare HIGH+MOD',
    description: 'gnomAD AF <= 1% + HIGH or MODERATE impact',
    filterJson: { maxGnomadAf: 0.01, consequences: ['HIGH', 'MODERATE'] },
    sortOrder: 2
  },
  {
    name: 'Ultra Rare HIGH',
    description: 'gnomAD AF <= 0.001% + HIGH impact',
    filterJson: { maxGnomadAf: 0.00001, consequences: ['HIGH'] },
    sortOrder: 3
  },
  // ── Single-dimension presets (flexible building blocks) ──
  {
    name: 'ClinVar P/LP',
    description: 'ClinVar pathogenic or likely pathogenic',
    filterJson: { clinvars: CLINVAR_PATHOGENIC },
    sortOrder: 4
  },
  {
    name: 'HIGH Impact',
    description: 'HIGH impact variants only',
    filterJson: { consequences: ['HIGH'] },
    sortOrder: 5
  },
  {
    name: 'Rare (1%)',
    description: 'gnomAD AF <= 1% or missing',
    filterJson: { maxGnomadAf: 0.01 },
    sortOrder: 6
  },
  {
    name: 'CADD >= 20',
    description: 'CADD Phred score at least 20',
    filterJson: { minCadd: 20 },
    sortOrder: 7
  },
  // K counts every case in the database, including the open one (#455).
  {
    name: RARE_NOT_RECURRENT_PRESET_NAME,
    description: 'gnomAD AF <= 1% + seen in at most 3 cases',
    filterJson: { maxGnomadAf: 0.01, maxCarriers: 3 },
    sortOrder: 8
  }
] as const
