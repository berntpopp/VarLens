/**
 * Built-in filter presets shipped with VarLens.
 *
 * These are seeded into the filter_presets table on migration v15.
 * Users can hide them but not delete them. The filter_json stores
 * a Partial<FilterState> object matching the shared FilterState type.
 */

import type { FilterState } from '../../shared/types/filters'

interface BuiltInPresetDef {
  name: string
  description: string
  filterJson: Partial<FilterState>
  sortOrder: number
}

export const BUILT_IN_PRESETS: readonly BuiltInPresetDef[] = [
  {
    name: 'Rare (1%)',
    description: 'gnomAD AF <= 1% or missing',
    filterJson: { maxGnomadAf: 0.01 },
    sortOrder: 0
  },
  {
    name: 'Very Rare (0.1%)',
    description: 'gnomAD AF <= 0.1% or missing',
    filterJson: { maxGnomadAf: 0.001 },
    sortOrder: 1
  },
  {
    name: 'Ultra Rare',
    description: 'gnomAD AF <= 0.001% or missing',
    filterJson: { maxGnomadAf: 0.00001 },
    sortOrder: 2
  },
  {
    name: 'HIGH Impact',
    description: 'HIGH impact variants only',
    filterJson: { consequences: ['HIGH'] },
    sortOrder: 3
  },
  {
    name: 'HIGH+MOD',
    description: 'HIGH or MODERATE impact',
    filterJson: { consequences: ['HIGH', 'MODERATE'] },
    sortOrder: 4
  },
  {
    name: 'CADD >= 15',
    description: 'CADD Phred score at least 15',
    filterJson: { minCadd: 15 },
    sortOrder: 5
  },
  {
    name: 'CADD >= 20',
    description: 'CADD Phred score at least 20',
    filterJson: { minCadd: 20 },
    sortOrder: 6
  },
  {
    name: 'ClinVar Path.',
    description: 'ClinVar pathogenic or likely pathogenic',
    filterJson: {
      clinvars: ['Pathogenic', 'Likely_pathogenic', 'Pathogenic/Likely_pathogenic']
    },
    sortOrder: 7
  }
] as const
