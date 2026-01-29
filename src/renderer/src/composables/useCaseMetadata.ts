/**
 * Composable for case metadata state management
 *
 * Provides reactive metadata state per case with IPC-backed persistence.
 * Used by CaseList, CaseMetadataCard for status, cohort, and HPO display/editing.
 */

import { ref } from 'vue'
import type {
  CaseMetadata,
  CohortGroup,
  CaseHpoTerm,
  AffectedStatus,
  FullCaseMetadata
} from '../../../shared/types/api'

// Cache full metadata by caseId
const metadataCache = ref<Map<number, FullCaseMetadata>>(new Map())

// Loading states per case
const loadingStates = ref<Map<number, boolean>>(new Map())

// Global cohort groups list
const cohortGroupsCache = ref<CohortGroup[]>([])

export function useCaseMetadata() {
  // Load full metadata for a case (metadata + cohorts + HPO terms)
  async function loadMetadata(caseId: number): Promise<void> {
    // Skip if already cached or loading
    if (metadataCache.value.has(caseId) || loadingStates.value.get(caseId) === true) {
      return
    }

    loadingStates.value.set(caseId, true)
    try {
      const result = await window.api.caseMetadata.getFullMetadata(caseId)
      metadataCache.value.set(caseId, result)
    } catch (error) {
      console.error('Failed to load case metadata:', error)
    } finally {
      loadingStates.value.set(caseId, false)
    }
  }

  // Load global cohort groups list
  async function loadCohortGroups(): Promise<void> {
    try {
      const cohorts = await window.api.caseMetadata.listCohorts()
      cohortGroupsCache.value = cohorts
    } catch (error) {
      console.error('Failed to load cohort groups:', error)
    }
  }

  // Get metadata from cache
  function getMetadata(caseId: number): FullCaseMetadata | undefined {
    return metadataCache.value.get(caseId)
  }

  // Check if loading
  function isLoading(caseId: number): boolean {
    return loadingStates.value.get(caseId) ?? false
  }

  // Update affected status with optimistic update
  async function updateStatus(caseId: number, status: AffectedStatus): Promise<void> {
    const current = metadataCache.value.get(caseId)
    const previousStatus = current?.metadata?.affected_status ?? null

    // Optimistic update
    if (current) {
      current.metadata = {
        ...current.metadata,
        case_id: caseId,
        affected_status: status
      } as CaseMetadata
    }

    try {
      const updated = await window.api.caseMetadata.upsert(caseId, { affected_status: status })
      // Update cache with server response
      const cached = metadataCache.value.get(caseId)
      if (cached) {
        cached.metadata = updated
      }
    } catch (error) {
      console.error('Failed to update status:', error)
      // Revert optimistic update
      if (current && current.metadata) {
        current.metadata.affected_status = previousStatus
      }
    }
  }

  // Set case cohorts with optimistic update (bulk replace)
  async function setCaseCohorts(caseId: number, cohortIds: number[]): Promise<void> {
    const current = metadataCache.value.get(caseId)
    const previousCohorts = current?.cohorts ?? []

    // Optimistic update: filter cohortGroupsCache by ids
    const newCohorts = cohortGroupsCache.value.filter((c) => cohortIds.includes(c.id))
    if (current) {
      current.cohorts = newCohorts
    }

    try {
      await window.api.caseMetadata.setCohorts(caseId, cohortIds)
    } catch (error) {
      console.error('Failed to set cohorts:', error)
      // Revert optimistic update
      if (current) {
        current.cohorts = previousCohorts
      }
      // Reload full metadata to ensure consistency
      metadataCache.value.delete(caseId)
      await loadMetadata(caseId)
    }
  }

  // Create new cohort and assign to case
  async function createAndAssignCohort(caseId: number, name: string): Promise<CohortGroup> {
    const newCohort = await window.api.caseMetadata.createCohort(name)

    // Add to global cohort groups cache
    cohortGroupsCache.value.push(newCohort)

    // Assign to case
    await window.api.caseMetadata.assignCohort(caseId, newCohort.id)

    // Update case metadata cache
    const current = metadataCache.value.get(caseId)
    if (current) {
      current.cohorts.push(newCohort)
    }

    return newCohort
  }

  // Get or create cohort by name
  async function getOrCreateCohort(name: string): Promise<CohortGroup> {
    // Check if exists in cache
    const existing = cohortGroupsCache.value.find((c) => c.name === name)
    if (existing) {
      return existing
    }

    // Create new cohort
    const newCohort = await window.api.caseMetadata.createCohort(name)

    // Add to cache
    cohortGroupsCache.value.push(newCohort)

    return newCohort
  }

  // Assign HPO term to case with optimistic update
  async function assignHpoTerm(caseId: number, hpoId: string, hpoLabel: string): Promise<void> {
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
    }

    try {
      const created = await window.api.caseMetadata.assignHpoTerm(caseId, hpoId, hpoLabel)
      // Update cache with server response (correct ID)
      if (current) {
        const index = current.hpoTerms.findIndex((t) => t.hpo_id === hpoId)
        if (index !== -1) {
          current.hpoTerms[index] = created
        }
      }
    } catch (error) {
      console.error('Failed to assign HPO term:', error)
      // Revert optimistic update
      if (current) {
        current.hpoTerms = current.hpoTerms.filter((t) => t.hpo_id !== hpoId)
      }
    }
  }

  // Remove HPO term from case with optimistic update
  async function removeHpoTerm(caseId: number, hpoId: string): Promise<void> {
    const current = metadataCache.value.get(caseId)
    const previousTerms = current?.hpoTerms ?? []

    // Optimistic update: remove from hpoTerms array
    if (current) {
      current.hpoTerms = current.hpoTerms.filter((t) => t.hpo_id !== hpoId)
    }

    try {
      await window.api.caseMetadata.removeHpoTerm(caseId, hpoId)
    } catch (error) {
      console.error('Failed to remove HPO term:', error)
      // Revert optimistic update
      if (current) {
        current.hpoTerms = previousTerms
      }
    }
  }

  // Clear all caches (call on database switch)
  function clearCache(): void {
    metadataCache.value.clear()
    loadingStates.value.clear()
    cohortGroupsCache.value = []
  }

  // Invalidate single case (force reload)
  function invalidateCase(caseId: number): void {
    metadataCache.value.delete(caseId)
    loadingStates.value.delete(caseId)
  }

  return {
    loadMetadata,
    loadCohortGroups,
    getMetadata,
    isLoading,
    updateStatus,
    setCaseCohorts,
    createAndAssignCohort,
    getOrCreateCohort,
    assignHpoTerm,
    removeHpoTerm,
    clearCache,
    invalidateCase,
    // Expose cache refs for direct access (reactive)
    cohortGroupsCache
  }
}

// Status display constants
export const STATUS_ICONS: Record<AffectedStatus, string> = {
  affected: 'mdi-account-alert',
  unaffected: 'mdi-account-check',
  unknown: 'mdi-help-circle-outline'
}

export const STATUS_COLORS: Record<AffectedStatus, string> = {
  affected: 'error',
  unaffected: 'success',
  unknown: 'grey'
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
