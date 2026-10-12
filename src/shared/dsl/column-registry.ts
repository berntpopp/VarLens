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
  /**
   * Per-case fields the cohort summary does not hold (#528). The cohort
   * backends reject a filter on them; autocomplete/validation should not
   * offer them in the cohort view.
   */
  caseOnly?: true
}

/** Which variant view a filter is written for. */
export type FilterScope = 'case' | 'cohort'

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
    caseOnly: true,
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
    caseOnly: true,
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
    label: 'Impact',
    aliases: ['impact', 'csq', 'effect'],
    type: 'categorical',
    operators: CATEGORICAL_OPERATORS,
    commonValues: [
      { value: 'HIGH', label: 'High impact' },
      { value: 'MODERATE', label: 'Moderate impact' },
      { value: 'LOW', label: 'Low impact' },
      { value: 'MODIFIER', label: 'Modifier' }
    ]
  },
  {
    key: 'func',
    label: 'Consequence',
    aliases: ['function'],
    // 'impact' is an alias of `consequence` above (HIGH/MODERATE/LOW/MODIFIER), never of func
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
    operators: ['=', '!=', '~'],
    caseOnly: true
  },
  {
    key: 'moi',
    label: 'Mode of Inheritance',
    aliases: ['inheritance', 'mode'],
    type: 'categorical',
    operators: CATEGORICAL_OPERATORS,
    caseOnly: true
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

const COUNT_OPERATORS: DslOperator[] = ['=', '!=', '<', '>', '<=', '>=']

/**
 * Cohort-summary fields (numeric column-filter keys) outside the shared
 * registry: only the cohort view can filter on them.
 */
export const COHORT_ONLY_COLUMNS: readonly FilterColumnDef[] = [
  {
    key: 'carrier_count',
    label: 'Carriers',
    aliases: [],
    type: 'numeric',
    operators: COUNT_OPERATORS
  },
  {
    key: 'cohort_frequency',
    label: 'Cohort frequency',
    aliases: [],
    type: 'numeric',
    operators: COUNT_OPERATORS
  },
  {
    key: 'het_count',
    label: 'Heterozygous carriers',
    aliases: [],
    type: 'numeric',
    operators: COUNT_OPERATORS
  },
  {
    key: 'hom_count',
    label: 'Homozygous carriers',
    aliases: [],
    type: 'numeric',
    operators: COUNT_OPERATORS
  }
]

/**
 * Operators for `info.<KEY>` fields (custom VCF INFO values, case view only,
 * #538) besides `is:null` / `is:notnull`. The fields are per case and not in
 * FILTER_COLUMNS; the parser validates the key against the VCF INFO ID grammar.
 */
export const INFO_FIELD_OPERATORS: readonly DslOperator[] = [...NUMERIC_OPERATORS, '~']

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

/** Whether a column can be filtered in the given view (case-only fields not in cohort). */
export function isColumnInScope(col: FilterColumnDef, scope: FilterScope): boolean {
  return scope === 'case' || col.caseOnly !== true
}

/** Get all column keys and aliases for autocomplete matching */
export function getColumnSuggestions(
  partial: string,
  scope: FilterScope = 'case'
): FilterColumnDef[] {
  const lower = partial.toLowerCase()
  return FILTER_COLUMNS.filter(
    (col) =>
      isColumnInScope(col, scope) &&
      (lower === '' ||
        col.key.toLowerCase().startsWith(lower) ||
        col.label.toLowerCase().startsWith(lower) ||
        col.aliases.some((a) => a.toLowerCase().startsWith(lower)))
  ) as FilterColumnDef[]
}
