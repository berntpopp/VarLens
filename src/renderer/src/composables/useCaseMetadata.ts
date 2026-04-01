/**
 * Composable for case metadata state management
 *
 * Provides reactive metadata state per case with IPC-backed persistence.
 * Used by CaseList, CaseMetadataCard for status, cohort, and HPO display/editing.
 */

import { ref, shallowRef, triggerRef } from 'vue'
import { logService } from '../services/LogService'
import { useCaseComments } from './useCaseComments'
import { useCaseMetrics } from './useCaseMetrics'
import { useApiService } from './useApiService'
import { LruMap } from '../../../shared/utils/lru-map'
import {
  mdiAccountAlert,
  mdiAccountCheck,
  mdiGenderFemale,
  mdiGenderMale,
  mdiGenderNonBinary,
  mdiHelpCircleOutline
} from '@mdi/js'
import type {
  CaseMetadata,
  CohortGroup,
  CaseHpoTerm,
  AffectedStatus,
  CaseSex,
  FullCaseMetadata
} from '../../../shared/types/api'

/** Maximum cached case metadata entries — evicts oldest on overflow */
const MAX_METADATA_CACHE_SIZE = 200

// Cache full metadata by caseId — shallowRef avoids deep reactivity overhead
// on the Map's values (FullCaseMetadata objects are never observed individually)
const metadataCache = shallowRef<LruMap<number, FullCaseMetadata>>(
  new LruMap(MAX_METADATA_CACHE_SIZE)
)

// Loading states per case — shallowRef since we trigger manually
const loadingStates = shallowRef<Map<number, boolean>>(new Map())

/**
 * Notify Vue that metadataCache changed (batched via microtask).
 * Multiple synchronous mutations within one tick coalesce into a single
 * triggerRef — this is intentional for optimistic updates where a mutation
 * and its revert may both run before the next render cycle.
 */
let _pendingTrigger = false
function triggerCacheUpdate(): void {
  if (!_pendingTrigger) {
    _pendingTrigger = true
    Promise.resolve().then(() => {
      triggerRef(metadataCache)
      _pendingTrigger = false
    })
  }
}

// Global cohort groups list
const cohortGroupsCache = ref<CohortGroup[]>([])

export function useCaseMetadata() {
  const { api } = useApiService()

  // Load full metadata for a case (metadata + cohorts + HPO terms)
  async function loadMetadata(caseId: number): Promise<void> {
    if (!api) return
    // Skip if already cached or loading
    if (metadataCache.value.has(caseId) || loadingStates.value.get(caseId) === true) {
      return
    }

    loadingStates.value.set(caseId, true)
    triggerRef(loadingStates)
    try {
      const result = await api.caseMetadata.getFullMetadata(caseId)
      metadataCache.value.set(caseId, result)
      triggerCacheUpdate()
    } catch (error) {
      logService.error(
        'Failed to load case metadata: ' + (error instanceof Error ? error.message : String(error)),
        'case-metadata'
      )
    } finally {
      loadingStates.value.set(caseId, false)
      triggerRef(loadingStates)
    }
  }

  // Load global cohort groups list
  async function loadCohortGroups(): Promise<void> {
    if (!api) return
    try {
      const cohorts = await api.caseMetadata.listCohorts()
      cohortGroupsCache.value = cohorts
    } catch (error) {
      logService.error(
        'Failed to load cohort groups: ' + (error instanceof Error ? error.message : String(error)),
        'case-metadata'
      )
    }
  }

  // Get metadata from cache (LruMap.get() promotes to most-recently-used automatically)
  function getMetadata(caseId: number): FullCaseMetadata | undefined {
    return metadataCache.value.get(caseId)
  }

  // Check if loading
  function isLoading(caseId: number): boolean {
    return loadingStates.value.get(caseId) ?? false
  }

  // Update affected status with optimistic update
  async function updateStatus(caseId: number, status: AffectedStatus): Promise<void> {
    if (!api) return
    const current = metadataCache.value.get(caseId)
    const previousStatus = current?.metadata?.affected_status ?? null

    // Optimistic update
    if (current) {
      current.metadata = {
        ...current.metadata,
        case_id: caseId,
        affected_status: status
      } as CaseMetadata
      triggerCacheUpdate()
    }

    try {
      const updated = await api.caseMetadata.upsert(caseId, { affected_status: status })
      // Update cache with server response
      const cached = metadataCache.value.get(caseId)
      if (cached) {
        cached.metadata = updated
        triggerCacheUpdate()
      }
    } catch (error) {
      logService.error(
        'Failed to update status: ' + (error instanceof Error ? error.message : String(error)),
        'case-metadata'
      )
      // Revert optimistic update
      if (current && current.metadata) {
        current.metadata.affected_status = previousStatus
        triggerCacheUpdate()
      }
    }
  }

  // Update sex with optimistic update
  async function updateSex(caseId: number, sex: CaseSex): Promise<void> {
    if (!api) return
    const current = metadataCache.value.get(caseId)
    const previousSex = current?.metadata?.sex ?? null

    // Optimistic update
    if (current) {
      current.metadata = {
        ...current.metadata,
        case_id: caseId,
        sex: sex
      } as CaseMetadata
      triggerCacheUpdate()
    }

    try {
      const updated = await api.caseMetadata.upsert(caseId, { sex })
      const cached = metadataCache.value.get(caseId)
      if (cached) {
        cached.metadata = updated
        triggerCacheUpdate()
      }
    } catch (error) {
      logService.error(
        'Failed to update sex: ' + (error instanceof Error ? error.message : String(error)),
        'case-metadata'
      )
      if (current && current.metadata) {
        current.metadata.sex = previousSex
        triggerCacheUpdate()
      }
    }
  }

  // Update age with optimistic update
  async function updateAge(caseId: number, age: number | null): Promise<void> {
    if (!api) return
    const current = metadataCache.value.get(caseId)
    const previousAge = current?.metadata?.age ?? null

    // Optimistic update
    if (current) {
      current.metadata = {
        ...current.metadata,
        case_id: caseId,
        age
      } as CaseMetadata
      triggerCacheUpdate()
    }

    try {
      const updated = await api.caseMetadata.upsert(caseId, { age })
      const cached = metadataCache.value.get(caseId)
      if (cached) {
        cached.metadata = updated
        triggerCacheUpdate()
      }
    } catch (error) {
      logService.error(
        'Failed to update age: ' + (error instanceof Error ? error.message : String(error)),
        'case-metadata'
      )
      if (current && current.metadata) {
        current.metadata.age = previousAge
        triggerCacheUpdate()
      }
    }
  }

  // Update date of birth with optimistic update
  async function updateDob(caseId: number, dateOfBirth: string | null): Promise<void> {
    if (!api) return
    const current = metadataCache.value.get(caseId)
    const previousDob = current?.metadata?.date_of_birth ?? null

    // Optimistic update
    if (current) {
      current.metadata = {
        ...current.metadata,
        case_id: caseId,
        date_of_birth: dateOfBirth
      } as CaseMetadata
      triggerCacheUpdate()
    }

    try {
      const updated = await api.caseMetadata.upsert(caseId, {
        date_of_birth: dateOfBirth
      })
      const cached = metadataCache.value.get(caseId)
      if (cached) {
        cached.metadata = updated
        triggerCacheUpdate()
      }
    } catch (error) {
      logService.error(
        'Failed to update date of birth: ' +
          (error instanceof Error ? error.message : String(error)),
        'case-metadata'
      )
      if (current && current.metadata) {
        current.metadata.date_of_birth = previousDob
        triggerCacheUpdate()
      }
    }
  }

  // Set case cohorts with optimistic update (bulk replace)
  async function setCaseCohorts(caseId: number, cohortIds: number[]): Promise<void> {
    if (!api) return
    const current = metadataCache.value.get(caseId)
    const previousCohorts = current?.cohorts ?? []

    // Optimistic update: filter cohortGroupsCache by ids
    const newCohorts = cohortGroupsCache.value.filter((c) => cohortIds.includes(c.id))
    if (current) {
      current.cohorts = newCohorts
      triggerCacheUpdate()
    }

    try {
      await api.caseMetadata.setCohorts(caseId, cohortIds)
    } catch (error) {
      logService.error(
        'Failed to set cohorts: ' + (error instanceof Error ? error.message : String(error)),
        'case-metadata'
      )
      if (current) {
        current.cohorts = previousCohorts
        triggerCacheUpdate()
      }
      // Reload full metadata to ensure consistency
      metadataCache.value.delete(caseId)
      await loadMetadata(caseId)
    }
  }

  // Create new cohort and assign to case
  async function createAndAssignCohort(caseId: number, name: string): Promise<CohortGroup | null> {
    if (!api) return null
    const newCohort = await api.caseMetadata.createCohort(name)

    // Add to global cohort groups cache
    cohortGroupsCache.value.push(newCohort)

    // Assign to case
    await api.caseMetadata.assignCohort(caseId, newCohort.id)

    // Update case metadata cache
    const current = metadataCache.value.get(caseId)
    if (current) {
      current.cohorts.push(newCohort)
      triggerCacheUpdate()
    }

    return newCohort
  }

  // Get or create cohort by name
  async function getOrCreateCohort(name: string): Promise<CohortGroup | null> {
    if (!api) return null
    // Check if exists in cache
    const existing = cohortGroupsCache.value.find((c) => c.name === name)
    if (existing) {
      return existing
    }

    // Create new cohort
    const newCohort = await api.caseMetadata.createCohort(name)

    // Add to cache
    cohortGroupsCache.value.push(newCohort)

    return newCohort
  }

  // Assign HPO term to case with optimistic update
  async function assignHpoTerm(caseId: number, hpoId: string, hpoLabel: string): Promise<void> {
    if (!api) return
    const current = metadataCache.value.get(caseId)

    // Optimistic update: add to hpoTerms array
    const newTerm: CaseHpoTerm = {
      id: 0, // Temporary ID, will be replaced by server response
      case_id: caseId,
      hpo_id: hpoId,
      hpo_label: hpoLabel,
      created_at: Date.now()
    }

    if (current) {
      current.hpoTerms.push(newTerm)
      triggerCacheUpdate()
    }

    try {
      const created = await api.caseMetadata.assignHpoTerm(caseId, hpoId, hpoLabel)
      if (current) {
        const index = current.hpoTerms.findIndex((t) => t.hpo_id === hpoId)
        if (index !== -1) {
          current.hpoTerms[index] = created
          triggerCacheUpdate()
        }
      }
    } catch (error) {
      logService.error(
        'Failed to assign HPO term: ' + (error instanceof Error ? error.message : String(error)),
        'case-metadata'
      )
      if (current) {
        current.hpoTerms = current.hpoTerms.filter((t) => t.hpo_id !== hpoId)
        triggerCacheUpdate()
      }
    }
  }

  // Remove HPO term from case with optimistic update
  async function removeHpoTerm(caseId: number, hpoId: string): Promise<void> {
    if (!api) return
    const current = metadataCache.value.get(caseId)
    const previousTerms = current?.hpoTerms ?? []

    // Optimistic update: remove from hpoTerms array
    if (current) {
      current.hpoTerms = current.hpoTerms.filter((t) => t.hpo_id !== hpoId)
      triggerCacheUpdate()
    }

    try {
      await api.caseMetadata.removeHpoTerm(caseId, hpoId)
    } catch (error) {
      logService.error(
        'Failed to remove HPO term: ' + (error instanceof Error ? error.message : String(error)),
        'case-metadata'
      )
      if (current) {
        current.hpoTerms = previousTerms
        triggerCacheUpdate()
      }
    }
  }

  // Clear all caches (call on database switch)
  function clearCache(): void {
    metadataCache.value.clear()
    triggerRef(metadataCache)
    loadingStates.value.clear()
    triggerRef(loadingStates)
    cohortGroupsCache.value = []
    useCaseComments().clearCache()
    useCaseMetrics().clearCache()
  }

  // Invalidate single case (force reload)
  function invalidateCase(caseId: number): void {
    metadataCache.value.delete(caseId)
    triggerCacheUpdate()
    loadingStates.value.delete(caseId)
    triggerRef(loadingStates)
  }

  return {
    loadMetadata,
    loadCohortGroups,
    getMetadata,
    isLoading,
    updateStatus,
    updateSex,
    updateAge,
    updateDob,
    setCaseCohorts,
    createAndAssignCohort,
    getOrCreateCohort,
    assignHpoTerm,
    removeHpoTerm,
    clearCache,
    invalidateCase,
    // Expose cache refs for direct access (reactive)
    cohortGroupsCache,
    metadataCache
  }
}

// Status display constants
export const STATUS_ICONS: Record<AffectedStatus, string> = {
  affected: mdiAccountAlert,
  unaffected: mdiAccountCheck,
  unknown: mdiHelpCircleOutline
}

export const STATUS_COLORS: Record<AffectedStatus, string> = {
  affected: 'error',
  unaffected: 'success',
  unknown: 'grey-darken-1'
}

// Sex display constants
export const SEX_ICONS: Record<CaseSex, string> = {
  male: mdiGenderMale,
  female: mdiGenderFemale,
  other: mdiGenderNonBinary,
  unknown: mdiHelpCircleOutline
}

export const SEX_COLORS: Record<CaseSex, string> = {
  male: 'blue',
  female: 'pink',
  other: 'purple',
  unknown: 'grey-darken-1'
}

// Cohort color function (deterministic hash-based)
export function getCohortColor(name: string): string {
  const colors = [
    'primary',
    'secondary',
    'success',
    'info',
    'warning',
    'purple',
    'pink',
    'indigo',
    'teal',
    'cyan'
  ]
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  return colors[Math.abs(hash) % colors.length]
}
