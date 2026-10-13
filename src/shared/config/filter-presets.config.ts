/**
 * Built-in filter presets shipped with VarLens, named by the clinical question
 * they answer (#570). The description is the preset chip's tooltip.
 *
 * These are seeded into the filter_presets table on migration v15 (v45 adds "Rare, not recurrent" to existing databases;
 * v54 / PG 0037 rename the older built-ins, see BUILT_IN_PRESET_RENAMES_V54).
 * Users can hide them but not delete them. The filter_json stores
 * a Partial<FilterState> object matching the shared FilterState type.
 *
 * Presets are designed as clinically meaningful combinations:
 * - Combo presets (frequency + impact/pathogenicity) for common workflows
 * - Single-dimension presets for flexible mix-and-match
 */

import type { FilterState } from '../types/filters'

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
    name: 'Rare known pathogenic',
    description: 'Rare (gnomAD AF <= 1%) and ClinVar pathogenic or likely pathogenic',
    filterJson: { maxGnomadAf: 0.01, clinvars: CLINVAR_PATHOGENIC },
    sortOrder: 0
  },
  {
    name: 'Rare loss-of-function',
    description: 'Rare (gnomAD AF <= 1%) and HIGH impact: stop, frameshift, splice site',
    filterJson: { maxGnomadAf: 0.01, consequences: ['HIGH'] },
    sortOrder: 1
  },
  {
    name: 'Rare protein-altering',
    description: 'Rare (gnomAD AF <= 1%) and HIGH or MODERATE impact, missense included',
    filterJson: { maxGnomadAf: 0.01, consequences: ['HIGH', 'MODERATE'] },
    sortOrder: 2
  },
  {
    name: 'Ultra-rare loss-of-function',
    description: 'Almost absent from gnomAD (AF <= 0.001%) and HIGH impact',
    filterJson: { maxGnomadAf: 0.00001, consequences: ['HIGH'] },
    sortOrder: 3
  },
  // ── Single-dimension presets (flexible building blocks) ──
  {
    name: 'Known pathogenic',
    description: 'ClinVar pathogenic or likely pathogenic, at any frequency',
    filterJson: { clinvars: CLINVAR_PATHOGENIC },
    sortOrder: 4
  },
  {
    name: 'Loss-of-function',
    description: 'HIGH impact (stop, frameshift, splice site), at any frequency',
    filterJson: { consequences: ['HIGH'] },
    sortOrder: 5
  },
  {
    name: 'Rare in population',
    description: 'gnomAD AF <= 1%, or not in gnomAD',
    filterJson: { maxGnomadAf: 0.01 },
    sortOrder: 6
  },
  {
    name: 'Predicted deleterious',
    description: 'CADD Phred score at least 20 (top 1% most deleterious)',
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

/**
 * Fixed record of the v54 / PG 0037 rename (#570): built-in name before, name
 * after. Both migrations also set the description current at the
 * time of writing (SQLite reads them from BUILT_IN_PRESETS, the PG SQL repeats
 * them); tests fail if either side drifts.
 */
export const BUILT_IN_PRESET_RENAMES_V54: ReadonlyArray<readonly [string, string]> = [
  ['Rare Pathogenic', 'Rare known pathogenic'],
  ['Rare HIGH', 'Rare loss-of-function'],
  ['Rare HIGH+MOD', 'Rare protein-altering'],
  ['Ultra Rare HIGH', 'Ultra-rare loss-of-function'],
  ['ClinVar P/LP', 'Known pathogenic'],
  ['HIGH Impact', 'Loss-of-function'],
  ['Rare (1%)', 'Rare in population'],
  ['CADD >= 20', 'Predicted deleterious']
]
