/**
 * The one place a query key is written.
 *
 * Every key starts with the database revision, so data from one database can
 * never be read under another, even when their case ids collide. Below the
 * root, data is keyed by case or cohort scope.
 */
import type { EntryKey } from '@pinia/colada'

import { useDatabaseStore } from '../stores/databaseStore'

/** A single case, or a cohort of cases. */
export interface QueryScope {
  caseId?: number
  caseIds?: number[]
}

export function isEmptyScope(scope: QueryScope): boolean {
  return scope.caseId === undefined && (scope.caseIds === undefined || scope.caseIds.length === 0)
}

const VARIANT_TAGS = 'variant-tags'

function root() {
  return ['db', useDatabaseStore().revision] as const
}

function caseScope(caseId: number) {
  return [...root(), 'case', caseId] as const
}

/** Cohort ids are sorted so `[3,1,2]` and `[1,2,3]` are the same scope. */
function scopeKey(scope: QueryScope) {
  if (scope.caseId !== undefined) return caseScope(scope.caseId)
  const ids = [...(scope.caseIds ?? [])].sort((a, b) => a - b).join(',')
  return [...root(), 'cohort', ids] as const
}

export const queryKeys = {
  root,
  tags: () => [...root(), 'tags'] as const,
  filterPresets: () => [...root(), 'filter-presets'] as const,
  caseIds: () => [...root(), 'case-ids'] as const,
  transcripts: (variantId: number) => [...root(), 'variant', variantId, 'transcripts'] as const,
  protein: (kind: 'mapping' | 'gene-structure' | 'domains' | 'structure', id: string) =>
    [...root(), 'protein', kind, id] as const,
  proteinRoot: () => [...root(), 'protein'] as const,
  enrichment: (provider: 'vep' | 'myvariant' | 'spliceai', variant: string) =>
    [...root(), 'enrichment', provider, variant] as const,
  metricDefinitions: () => [...root(), 'metric-definitions'] as const,
  caseComments: (caseId: number) => [...caseScope(caseId), 'comments'] as const,
  caseMetrics: (caseId: number) => [...caseScope(caseId), 'metrics'] as const,
  caseDataInfo: (caseId: number) => [...caseScope(caseId), 'data-info'] as const,
  filterOptions: (caseId: number) => [...caseScope(caseId), 'filter-options'] as const,
  variantTags: (caseId: number, variantId: number) =>
    [...caseScope(caseId), VARIANT_TAGS, variantId] as const,
  typesPresent: (scope: QueryScope) => [...scopeKey(scope), 'types-present'] as const,
  columnMeta: (scope: QueryScope, columnKey: string) =>
    [...scopeKey(scope), 'column-meta', columnKey] as const,
  isVariantTags: (key: EntryKey) => key[key.length - 2] === VARIANT_TAGS
}
