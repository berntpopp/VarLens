/**
 * Column metadata registry for the filter DSL.
 *
 * Defines all filterable columns with their types, valid operators,
 * aliases (for autocomplete), and common preset values. This drives
 * both the DSL parser validation and the autocomplete suggestions.
 */

import type { DslOperator } from './types'

/** Common value suggestion for autocomplete */
export interface CommonValue {
  value: string | number
  label: string
}

/** Definition of a filterable column */
export interface FilterColumnDef {
  /** Database column name (matches SORTABLE_COLUMNS in VariantRepository) */
  key: string
  /** Human-readable display name */
  label: string
  /** Alternative names for autocomplete matching */
  aliases: string[]
  /** Data type determining valid operators */
  type: 'numeric' | 'categorical' | 'text'
  /** Valid operators for this column type */
  operators: DslOperator[]
  /** Common values for autocomplete suggestions */
  commonValues?: CommonValue[]
}

const NUMERIC_OPERATORS: DslOperator[] = ['=', '!=', '<', '>', '<=', '>=']
// Note: '^' (starts with), '$' (ends with), '!~' (not contains), 'is:null', 'is:notnull'
// are excluded until the backend column filter API supports them.
const TEXT_OPERATORS: DslOperator[] = ['=', '!=', '~']
const CATEGORICAL_OPERATORS: DslOperator[] = ['=', '!=', '~']

export const FILTER_COLUMNS: readonly FilterColumnDef[] = [
  {
    key: 'gnomad_af',
    label: 'gnomAD AF',
    aliases: ['af', 'frequency', 'gnomad', 'maf'],
    type: 'numeric',
    operators: NUMERIC_OPERATORS,
    commonValues: [
      { value: 0.01, label: '1%' },
      { value: 0.001, label: '0.1%' },
      { value: 0.0001, label: '0.01%' },
      { value: 0.00001, label: '0.001%' }
    ]
  },
  {
    key: 'cadd',
    label: 'CADD',
    aliases: ['cadd_phred', 'cadd_score'],
    type: 'numeric',
    operators: NUMERIC_OPERATORS,
    commonValues: [
      { value: 10, label: 'CADD 10' },
      { value: 15, label: 'CADD 15' },
      { value: 20, label: 'CADD 20' },
      { value: 25, label: 'CADD 25' }
    ]
  },
  {
    key: 'qual',
    label: 'Quality',
    aliases: ['quality', 'q'],
    type: 'numeric',
    operators: NUMERIC_OPERATORS,
    commonValues: [
      { value: 100, label: 'Q100' },
      { value: 300, label: 'Q300' },
      { value: 500, label: 'Q500' }
    ]
  },
  {
    key: 'hpo_sim_score',
    label: 'HPO Score',
    aliases: ['hpo', 'hpo_score', 'similarity'],
    type: 'numeric',
    operators: NUMERIC_OPERATORS,
    commonValues: [
      { value: 0.1, label: '0.1' },
      { value: 0.3, label: '0.3' },
      { value: 0.5, label: '0.5' }
    ]
  },
  {
    key: 'pos',
    label: 'Position',
    aliases: ['position'],
    type: 'numeric',
    operators: NUMERIC_OPERATORS
  },
  {
    key: 'gene_symbol',
    label: 'Gene',
    aliases: ['gene', 'symbol'],
    type: 'text',
    operators: TEXT_OPERATORS
  },
  {
    key: 'consequence',
    label: 'Consequence',
    aliases: ['csq', 'effect'],
    type: 'categorical',
    operators: CATEGORICAL_OPERATORS
  },
  {
    key: 'func',
    label: 'Function',
    aliases: ['function'],
    // Note: 'impact' is NOT an alias for func — the spec uses impact:=:HIGH
    // but that maps to the consequences filter (HIGH/MODERATE/LOW), not func
    type: 'categorical',
    operators: CATEGORICAL_OPERATORS
  },
  {
    key: 'clinvar',
    label: 'ClinVar',
    aliases: ['clinvar_sig', 'clinsig'],
    type: 'categorical',
    operators: CATEGORICAL_OPERATORS
  },
  {
    key: 'chr',
    label: 'Chromosome',
    aliases: ['chrom', 'chromosome'],
    type: 'text',
    operators: ['=', '!=']
  },
  {
    key: 'gt_num',
    label: 'Genotype',
    aliases: ['genotype', 'gt'],
    type: 'text',
    operators: ['=', '!=', '~']
  },
  {
    key: 'moi',
    label: 'Mode of Inheritance',
    aliases: ['inheritance', 'mode'],
    type: 'categorical',
    operators: CATEGORICAL_OPERATORS
  },
  {
    key: 'transcript',
    label: 'Transcript',
    aliases: ['tx'],
    type: 'text',
    operators: TEXT_OPERATORS
  },
  {
    key: 'cdna',
    label: 'cDNA',
    aliases: ['cdna_change', 'hgvs_c'],
    type: 'text',
    operators: TEXT_OPERATORS
  },
  {
    key: 'aa_change',
    label: 'Protein Change',
    aliases: ['protein', 'hgvs_p', 'amino_acid'],
    type: 'text',
    operators: TEXT_OPERATORS
  },
  {
    key: 'omim_mim_number',
    label: 'OMIM',
    aliases: ['omim', 'mim'],
    type: 'text',
    operators: ['=', '!=', '~']
  }
] as const

/** All known column keys for fast lookup */
const columnMap = new Map<string, FilterColumnDef>()
for (const col of FILTER_COLUMNS) {
  columnMap.set(col.key.toLowerCase(), col as FilterColumnDef)
  for (const alias of col.aliases) {
    columnMap.set(alias.toLowerCase(), col as FilterColumnDef)
  }
}

/** Find a column definition by key or alias (case-insensitive) */
export function findColumn(nameOrAlias: string): FilterColumnDef | undefined {
  return columnMap.get(nameOrAlias.toLowerCase())
}

/** Get valid operators for a column (empty array if unknown) */
export function getOperatorsForColumn(nameOrAlias: string): DslOperator[] {
  return findColumn(nameOrAlias)?.operators ?? []
}

/** Get common value suggestions for a column (empty array if none) */
export function getCommonValues(nameOrAlias: string): CommonValue[] {
  return findColumn(nameOrAlias)?.commonValues ?? []
}

/** Get all column keys and aliases for autocomplete matching */
export function getColumnSuggestions(partial: string): FilterColumnDef[] {
  const lower = partial.toLowerCase()
  if (lower === '') return [...FILTER_COLUMNS]
  return FILTER_COLUMNS.filter(
    (col) =>
      col.key.toLowerCase().startsWith(lower) ||
      col.label.toLowerCase().startsWith(lower) ||
      col.aliases.some((a) => a.toLowerCase().startsWith(lower))
  ) as FilterColumnDef[]
}
