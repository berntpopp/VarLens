import { getActivePinia } from 'pinia'
import type { StorageCapabilities } from '../../../shared/types/storage-capabilities'
import { useDatabaseStore } from '../stores/databaseStore'

export type CapabilityPath =
  | 'variants.query'
  | 'variants.filterOptions'
  | 'variants.columnMeta'
  | 'variants.panelFilters'
  | 'variants.tagFilters'
  | 'variants.commentFilters'
  | 'variants.acmgFilters'
  | 'variants.annotationFilters'
  | 'variants.inheritanceFilters'
  | 'variants.analysisGroupFilters'
  | 'variants.phasingFilters'
  | 'cases.deleteOne'
  | 'cases.deleteMany'
  | 'cases.deleteAll'
  | 'cases.overview'
  | 'export.variants'
  | 'export.cohort'
  | 'cohort.query'
  | 'cohort.summary'
  | 'cohort.columnMeta'
  | 'workflow.tags'
  | 'workflow.annotations'
  | 'workflow.panels'
  | 'workflow.filterPresets'

export const LABELS: Record<CapabilityPath, string> = {
  'variants.query': 'variant browsing',
  'variants.filterOptions': 'variant filter options',
  'variants.columnMeta': 'variant column metadata',
  'variants.panelFilters': 'panel filters',
  'variants.tagFilters': 'tag filters',
  'variants.commentFilters': 'comment filters',
  'variants.acmgFilters': 'ACMG filters',
  'variants.annotationFilters': 'annotation filters',
  'variants.inheritanceFilters': 'inheritance filters',
  'variants.analysisGroupFilters': 'analysis group filters',
  'variants.phasingFilters': 'phasing filters',
  'cases.deleteOne': 'case deletion',
  'cases.deleteMany': 'batch case deletion',
  'cases.deleteAll': 'all-case deletion',
  'cases.overview': 'database overview',
  'export.variants': 'variant export',
  'export.cohort': 'cohort export',
  'cohort.query': 'cohort queries',
  'cohort.summary': 'cohort summary',
  'cohort.columnMeta': 'cohort column metadata',
  'workflow.tags': 'tags',
  'workflow.annotations': 'annotations',
  'workflow.panels': 'panels',
  'workflow.filterPresets': 'filter presets'
}

export function canUseFeature(capabilities: StorageCapabilities, path: CapabilityPath): boolean {
  const [group, key] = path.split('.') as [Exclude<keyof StorageCapabilities, 'backend'>, string]
  const value = capabilities[group]
  if (typeof value !== 'object' || value === null) {
    return false
  }
  return Boolean((value as Record<string, boolean>)[key])
}

export function getUnsupportedReason(
  capabilities: StorageCapabilities,
  path: CapabilityPath
): string | null {
  if (canUseFeature(capabilities, path)) {
    return null
  }

  const backendLabel = capabilities.backend === 'postgres' ? 'PostgreSQL' : 'this backend'
  return `${LABELS[path]} is not available for ${backendLabel} yet.`
}

/**
 * Storage-backend capability reads. Flags come from the capability document
 * (`capabilityStore`, via `databaseStore.capabilities`). FAIL-CLOSED: while the
 * document is missing (not loaded yet, failed, or no Pinia) every path reads as
 * unavailable and a reason is returned (spec §4.3, gap P-11).
 */
function notLoadedReason(path: CapabilityPath): string {
  return `${LABELS[path]} is unavailable until feature availability has loaded.`
}

export async function getCurrentUnsupportedReason(path: CapabilityPath): Promise<string | null> {
  if (getActivePinia() === undefined) {
    return notLoadedReason(path)
  }

  const databaseStore = useDatabaseStore()
  if (databaseStore.capabilities === null) {
    await databaseStore.loadCapabilities()
  }

  return databaseStore.capabilities === null
    ? notLoadedReason(path)
    : getUnsupportedReason(databaseStore.capabilities, path)
}

export function currentCanUseFeature(path: CapabilityPath): boolean {
  if (getActivePinia() === undefined) {
    return false
  }

  const databaseStore = useDatabaseStore()
  return databaseStore.capabilities !== null && canUseFeature(databaseStore.capabilities, path)
}

export function getCurrentUnsupportedReasonSync(path: CapabilityPath): string | null {
  if (getActivePinia() === undefined) {
    return notLoadedReason(path)
  }

  const databaseStore = useDatabaseStore()
  return databaseStore.capabilities === null
    ? notLoadedReason(path)
    : getUnsupportedReason(databaseStore.capabilities, path)
}
