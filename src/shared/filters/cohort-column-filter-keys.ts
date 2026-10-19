/**
 * Cohort-view column-filter keys, shared by the SQLite and PostgreSQL cohort
 * query paths (#528).
 *
 * The filter DSL canonicalises CADD to `cadd` (the case-view key) while the
 * cohort view's own column is `cadd_phred`; each backend used to accept only
 * one spelling and the SQLite path silently dropped any key it did not know,
 * so `cadd:>=:1000` returned every row. Both backends now normalise keys
 * through {@link normalizeCohortColumnFilters}, which rejects any key the
 * cohort summary cannot filter instead of discarding it.
 */
import type { ColumnFiltersParam } from '../types/column-filters'
import { resolveExtensionColumnKey } from '../types/variant-extension-registry-data'
import { infoFieldKey } from './info-field-filter'

/**
 * Canonical cohort column-filter key → stored `cohort_variant_summary` column.
 * `cohort_frequency` is derived at read time; each backend maps it to its own
 * expression.
 */
export const COHORT_SUMMARY_FILTER_COLUMNS: Readonly<Record<string, string>> = {
  chr: 'chr',
  pos: 'pos',
  ref: 'ref',
  alt: 'alt',
  gene_symbol: 'gene_symbol',
  cdna: 'cdna',
  aa_change: 'aa_change',
  consequence: 'consequence',
  func: 'func',
  clinvar: 'clinvar',
  gnomad_af: 'gnomad_af',
  cadd_phred: 'cadd',
  transcript: 'transcript',
  omim_mim_number: 'omim_mim_number',
  carrier_count: 'carrier_count',
  cohort_frequency: 'cohort_frequency',
  het_count: 'het_count',
  hom_count: 'hom_count',
  end_pos: 'end_pos',
  sv_type: 'sv_type',
  sv_length: 'sv_length',
  acmg_best: 'acmg_best',
  /** Best stored score over the carriers; each backend maps it to its probe. */
  phenotype_score: 'phenotype_score'
}

/** Accepted alternative spellings → canonical cohort key. */
const COHORT_FILTER_KEY_ALIASES: Readonly<Record<string, string>> = {
  // The DSL / case-view key for CADD.
  cadd: 'cadd_phred',
  acmg: 'acmg_best'
}

// Own keys only: request keys such as `constructor` must not match Object.prototype.
const hasOwn = (record: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(record, key)

/** The canonical cohort key for `key` (`cadd` → `cadd_phred`); other keys unchanged. */
export const canonicalCohortFilterKey = (key: string): string =>
  hasOwn(COHORT_FILTER_KEY_ALIASES, key) ? COHORT_FILTER_KEY_ALIASES[key] : key

/** Thrown when a cohort request filters on a column the cohort summary does not hold. */
export class UnsupportedCohortColumnFilterError extends Error {
  constructor(readonly columns: string[]) {
    super(`Unsupported cohort column filter(s): ${columns.join(', ')}`)
    this.name = 'UnsupportedCohortColumnFilterError'
  }
}

/**
 * Rename aliases to their canonical cohort key and verify every key is
 * filterable on the cohort view (a summary column, a known extension
 * column such as `cnv.copy_number`, or an `info.<KEY>` carrier filter).
 *
 * @throws {UnsupportedCohortColumnFilterError} naming every unsupported key —
 *   a case-only field (`qual`, `gt_num`, `hpo_sim_score`, `moi`) is never
 *   silently dropped.
 */
export function normalizeCohortColumnFilters(
  filters: ColumnFiltersParam | undefined
): ColumnFiltersParam | undefined {
  if (filters === undefined) return undefined
  const normalized: ColumnFiltersParam = {}
  const unsupported: string[] = []
  for (const [key, filter] of Object.entries(filters)) {
    const canonical = canonicalCohortFilterKey(key)
    if (
      hasOwn(COHORT_SUMMARY_FILTER_COLUMNS, canonical) ||
      resolveExtensionColumnKey(canonical) !== null ||
      infoFieldKey(canonical) !== null
    ) {
      if (hasOwn(normalized, canonical)) {
        throw new Error(`Conflicting cohort column filters for "${canonical}"`)
      }
      normalized[canonical] = filter
    } else {
      unsupported.push(key)
    }
  }
  if (unsupported.length > 0) throw new UnsupportedCohortColumnFilterError(unsupported)
  return normalized
}
