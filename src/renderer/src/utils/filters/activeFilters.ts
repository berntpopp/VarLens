/**
 * Active filters list computation
 *
 * Pure function for building active filters list for chip display.
 * Extracts duplicate logic from CohortTable.vue and FilterToolbar.vue.
 *
 * DRY-08: Eliminate duplicate activeFiltersList logic.
 */

import type { FilterState, ActiveFilter } from '../../../../shared/types/filters'
import type { ColumnFiltersParam } from '../../../../shared/types/column-filters'
import { INHERITANCE_MODE_META } from '../../../../shared/types/inheritance'

/** Human-readable labels for column filter keys */
const COLUMN_LABELS: Record<string, string> = {
  chr: 'Chr',
  pos: 'Position',
  gene_symbol: 'Gene',
  cdna: 'cDNA',
  aa_change: 'AA Change',
  consequence: 'Consequence',
  func: 'Function',
  clinvar: 'ClinVar',
  gnomad_af: 'gnomAD AF',
  cadd_phred: 'CADD',
  cadd: 'CADD',
  transcript: 'Transcript',
  carrier_count: 'Carriers',
  cohort_frequency: 'Cohort Freq',
  het_count: 'Het',
  hom_count: 'Hom',
  ref: 'Ref',
  alt: 'Alt',
  internal_af: 'Internal AF'
}

/**
 * Format a column filter value for chip display.
 * - numeric: "CADD >= 20"
 * - categorical (in): "Consequence: 3 selected"
 * - text (like): "Gene ~ BRCA"
 */
function formatColumnFilterValue(operator: string, value: string | number | string[]): string {
  if (operator === 'in' && Array.isArray(value)) {
    return `${value.length} selected`
  }
  if (operator === 'like') {
    return `~ ${value}`
  }
  // Numeric operators: =, !=, <, >, <=, >=
  return `${operator} ${value}`
}

/**
 * Build active filters list for chip display
 * Pure function - components wrap in computed() for reactivity
 *
 * @param filters - Current filter state
 * @param impactPresets - Selected impact preset names (optional)
 * @param columnFilters - Per-column typed filters (optional)
 * @returns Array of active filters for chip display
 *
 * @example
 * ```typescript
 * // In component:
 * const activeFiltersList = computed(() =>
 *   buildActiveFiltersList(filters.value, selectedImpactPresets.value, columnFiltersParam)
 * )
 * ```
 */
export function buildActiveFiltersList(
  filters: FilterState,
  impactPresets: string[] = [],
  columnFilters: ColumnFiltersParam = {}
): ActiveFilter[] {
  const list: ActiveFilter[] = []

  // Search/text filters
  if (filters.searchQuery !== '') {
    list.push({ id: 'search', label: 'Search', value: filters.searchQuery })
  }
  if (filters.geneSymbol !== '') {
    list.push({ id: 'gene', label: 'Gene', value: filters.geneSymbol })
  }

  // Impact - from presets or consequences array
  if (impactPresets.length > 0) {
    list.push({ id: 'impact', label: 'Impact', value: impactPresets.join(', ') })
  } else if (filters.consequences.length > 0) {
    list.push({ id: 'impact', label: 'Impact', value: `${filters.consequences.length} selected` })
  }

  // Array filters
  if (filters.funcs.length > 0) {
    list.push({ id: 'funcs', label: 'Function', value: `${filters.funcs.length} selected` })
  }
  if (filters.clinvars.length > 0) {
    list.push({ id: 'clinvars', label: 'ClinVar', value: `${filters.clinvars.length} selected` })
  }

  // Numeric filters - operator goes in value for cleaner chip display
  if (filters.maxGnomadAf !== null && filters.maxGnomadAf > 0) {
    const pct = (filters.maxGnomadAf * 100).toFixed(2)
    list.push({ id: 'frequency', label: 'AF', value: `<= ${pct}%` })
  }
  if (filters.maxInternalAf !== null && filters.maxInternalAf > 0) {
    const pct = (filters.maxInternalAf * 100).toFixed(2)
    list.push({ id: 'internal-frequency', label: 'Internal AF', value: `\u2264 ${pct}%` })
  }
  if (filters.minCadd !== null && filters.minCadd >= 0) {
    list.push({ id: 'cadd', label: 'CADD', value: `>= ${filters.minCadd}` })
  }
  if (filters.minCarriers !== null && filters.minCarriers > 0) {
    list.push({ id: 'carriers', label: 'Carriers', value: `>= ${filters.minCarriers}` })
  }

  // Annotation filters
  if (filters.starredOnly) {
    list.push({ id: 'starred', label: 'Starred', value: 'only' })
  }
  if (filters.hasCommentOnly) {
    list.push({ id: 'comments', label: 'Comments', value: 'only' })
  }
  if (filters.acmgClassifications.length > 0) {
    list.push({ id: 'acmg', label: 'ACMG', value: filters.acmgClassifications.join(', ') })
  }

  // Inheritance modes
  if (filters.inheritanceModes.length > 0) {
    const labels = filters.inheritanceModes.map((m) => {
      const meta = INHERITANCE_MODE_META[m as keyof typeof INHERITANCE_MODE_META]
      return meta?.abbr ?? m
    })
    list.push({ id: 'inheritance', label: 'Inheritance', value: labels.join(', ') })
  }

  // Gene panels
  if (filters.activePanelIds.length > 0) {
    list.push({
      id: 'panels',
      label: 'Panels',
      value: `${filters.activePanelIds.length} panel(s)`
    })
  }

  // Per-column typed filters
  for (const [key, filter] of Object.entries(columnFilters)) {
    const label = COLUMN_LABELS[key] ?? key
    const displayValue = formatColumnFilterValue(filter.operator, filter.value)
    list.push({ id: `col:${key}`, label, value: displayValue })
  }

  return list
}
