/**
 * Composable for case metadata state management
 *
 * Provides reactive metadata state per case with IPC-backed persistence.
 * Used by CaseList, CaseMetadataCard for status, cohort, and HPO display/editing.
 */

import { ref, shallowRef, triggerRef } from 'vue'
import { logService } from '../services/LogService'
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
import { formatErrorMessage } from '../../../shared/errors/format-error-message'
import { unwrapIpcResult } from '../../../shared/types/errors'
import { notifyPhenotypeChanged } from './phenotypeChanges'
import type { HpoTermFlags } from '../../../shared/types/hpo-profile'
import { resolveHpoTermFlags } from '../../../shared/utils/hpo-term-flags'

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
/**
 * Write a case's cache entry as a new object: in-place writes keep the entry's identity, so
 * computeds over `getMetadata()` would not re-render. No-op when the case is not cached.
 */
function patchCachedEntry(
  caseId: number,
  patch: (entry: FullCaseMetadata) => Partial<FullCaseMetadata>
): void {
  const entry = metadataCache.value.get(caseId)
  if (!entry) return
  metadataCache.value.set(caseId, { ...entry, ...patch(entry) })
  triggerCacheUpdate()
}

function setCachedHpoTerms(caseId: number, update: (terms: CaseHpoTerm[]) => CaseHpoTerm[]): void {
  patchCachedEntry(caseId, (entry) => ({ hpoTerms: update(entry.hpoTerms) }))
}

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

const caseMutationQueues = new Map<number, Promise<unknown>>()
const STALE_MUTATION = Symbol('stale-case-metadata-mutation')
let cacheGeneration = 0

function isCurrentGeneration(generation: number): boolean {
  return generation === cacheGeneration
}

async function serializeCaseMutation<T>(
  caseId: number,
  generation: number,
  mutation: () => Promise<T>
): Promise<T | typeof STALE_MUTATION> {
  const previous = caseMutationQueues.get(caseId) ?? Promise.resolve()
  const result: Promise<T | typeof STALE_MUTATION> = previous
    .catch(() => undefined)
    .then<T | typeof STALE_MUTATION>(() =>
      isCurrentGeneration(generation) ? mutation() : STALE_MUTATION
    )
  caseMutationQueues.set(caseId, result)
  try {
    return await result
  } finally {
    if (caseMutationQueues.get(caseId) === result) caseMutationQueues.delete(caseId)
  }
}

export function useCaseMetadata() {
  const { api } = useApiService()

  // Load full metadata for a case (metadata + cohorts + HPO terms)
  async function loadMetadata(caseId: number): Promise<void> {
    if (!api) return
    const generation = cacheGeneration
    // Skip if already cached or loading
    if (metadataCache.value.has(caseId) || loadingStates.value.get(caseId) === true) {
      return
    }

    loadingStates.value.set(caseId, true)
    triggerRef(loadingStates)
    try {
      const result = unwrapIpcResult(await api.caseMetadata.getFullMetadata(caseId))
      if (!isCurrentGeneration(generation)) return
      // invalidateCase() ran while this was in flight (case deleted): drop it.
      if (loadingStates.value.get(caseId) !== true) return
      metadataCache.value.set(caseId, result)
      triggerCacheUpdate()
    } catch (error) {
      if (!isCurrentGeneration(generation)) return
      logService.error(
        'Failed to load case metadata: ' + formatErrorMessage(error, 'Unknown error'),
        'case-metadata'
      )
    } finally {
      if (isCurrentGeneration(generation) && loadingStates.value.has(caseId)) {
        loadingStates.value.set(caseId, false)
        triggerRef(loadingStates)
      }
    }
  }

  // Load global cohort groups list
  async function loadCohortGroups(): Promise<void> {
    if (!api) return
    const generation = cacheGeneration
    try {
      const cohorts = unwrapIpcResult(await api.caseMetadata.listCohorts())
      if (!isCurrentGeneration(generation)) return
      cohortGroupsCache.value = cohorts
    } catch (error) {
      if (!isCurrentGeneration(generation)) return
      logService.error(
        'Failed to load cohort groups: ' + formatErrorMessage(error, 'Unknown error'),
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

  /** Upsert one metadata field, optimistic with rollback to the previous value. */
  async function upsertMetadataField<K extends 'affected_status' | 'sex' | 'age' | 'date_of_birth'>(
    caseId: number,
    field: K,
    value: CaseMetadata[K],
    label: string
  ): Promise<void> {
    if (!api) return
    const generation = cacheGeneration
    await serializeCaseMutation(caseId, generation, async () => {
      const previous = metadataCache.value.get(caseId)?.metadata?.[field] ?? null
      const withValue =
        (v: CaseMetadata[K] | null) =>
        (entry: FullCaseMetadata): Partial<FullCaseMetadata> => ({
          metadata: { ...entry.metadata, case_id: caseId, [field]: v } as CaseMetadata
        })
      patchCachedEntry(caseId, withValue(value))

      try {
        const updated = unwrapIpcResult(await api.caseMetadata.upsert(caseId, { [field]: value }))
        if (!isCurrentGeneration(generation)) return
        patchCachedEntry(caseId, () => ({ metadata: updated }))
      } catch (error) {
        if (!isCurrentGeneration(generation)) return
        logService.error(
          `Failed to update ${label}: ` + formatErrorMessage(error, 'Unknown error'),
          'case-metadata'
        )
        patchCachedEntry(caseId, (entry) => (entry.metadata ? withValue(previous)(entry) : {}))
        throw error
      }
    })
  }

  const updateStatus = (caseId: number, status: AffectedStatus): Promise<void> =>
    upsertMetadataField(caseId, 'affected_status', status, 'status')
  const updateSex = (caseId: number, sex: CaseSex): Promise<void> =>
    upsertMetadataField(caseId, 'sex', sex, 'sex')
  const updateAge = (caseId: number, age: number | null): Promise<void> =>
    upsertMetadataField(caseId, 'age', age, 'age')
  const updateDob = (caseId: number, dateOfBirth: string | null): Promise<void> =>
    upsertMetadataField(caseId, 'date_of_birth', dateOfBirth, 'date of birth')

  // Set case cohorts with optimistic update (bulk replace)
  async function setCaseCohorts(caseId: number, cohortIds: number[]): Promise<void> {
    if (!api) return
    const generation = cacheGeneration
    await serializeCaseMutation(caseId, generation, async () => {
      const previousCohorts = metadataCache.value.get(caseId)?.cohorts ?? []
      const newCohorts = cohortGroupsCache.value.filter((c) => cohortIds.includes(c.id))
      patchCachedEntry(caseId, () => ({ cohorts: newCohorts }))

      try {
        unwrapIpcResult(await api.caseMetadata.setCohorts(caseId, cohortIds))
        if (!isCurrentGeneration(generation)) return
      } catch (error) {
        if (!isCurrentGeneration(generation)) return
        logService.error(
          'Failed to set cohorts: ' + formatErrorMessage(error, 'Unknown error'),
          'case-metadata'
        )
        patchCachedEntry(caseId, () => ({ cohorts: previousCohorts }))
        metadataCache.value.delete(caseId)
        await loadMetadata(caseId)
        throw error
      }
    })
  }

  // Create new cohort and assign to case
  async function createAndAssignCohort(caseId: number, name: string): Promise<CohortGroup | null> {
    if (!api) return null
    const generation = cacheGeneration
    const result = await serializeCaseMutation(caseId, generation, async () => {
      const newCohort = unwrapIpcResult(await api.caseMetadata.createCohort(name))
      if (!isCurrentGeneration(generation)) return null
      cohortGroupsCache.value.push(newCohort)
      unwrapIpcResult(await api.caseMetadata.assignCohort(caseId, newCohort.id))
      if (!isCurrentGeneration(generation)) return null

      patchCachedEntry(caseId, (entry) => ({ cohorts: [...entry.cohorts, newCohort] }))

      return newCohort
    })
    return result === STALE_MUTATION ? null : result
  }

  // Get or create cohort by name
  async function getOrCreateCohort(name: string): Promise<CohortGroup | null> {
    if (!api) return null
    const generation = cacheGeneration
    // Check if exists in cache
    const existing = cohortGroupsCache.value.find((c) => c.name === name)
    if (existing) {
      return existing
    }

    // Create new cohort
    const newCohort = unwrapIpcResult(await api.caseMetadata.createCohort(name))
    if (!isCurrentGeneration(generation)) return null

    // Add to cache
    cohortGroupsCache.value.push(newCohort)

    return newCohort
  }

  // Assign (upsert) an HPO term with its status flags, optimistic with rollback.
  async function assignHpoTerm(
    caseId: number,
    hpoId: string,
    hpoLabel: string,
    flags?: HpoTermFlags
  ): Promise<void> {
    if (!api) return
    const generation = cacheGeneration
    await serializeCaseMutation(caseId, generation, async () => {
      const previousTerms = metadataCache.value.get(caseId)?.hpoTerms ?? []
      const existing = previousTerms.find((t) => t.hpo_id === hpoId)
      // Flags set the whole status (excluded wins over key); without flags a term keeps its own.
      const optimistic: CaseHpoTerm = {
        id: 0,
        case_id: caseId,
        created_at: Date.now(),
        excluded: false,
        key: false,
        ...existing,
        hpo_id: hpoId,
        hpo_label: hpoLabel,
        ...(flags ? resolveHpoTermFlags(flags) : {})
      }

      // New terms go where the server lists them (ORDER BY hpo_id on SQLite and Postgres).
      setCachedHpoTerms(caseId, (terms) =>
        existing
          ? terms.map((t) => (t.hpo_id === hpoId ? optimistic : t))
          : [...terms, optimistic].sort((x, y) => (x.hpo_id < y.hpo_id ? -1 : 1))
      )

      try {
        const created = unwrapIpcResult(
          await api.caseMetadata.assignHpoTerm(caseId, hpoId, hpoLabel, flags)
        )
        if (!isCurrentGeneration(generation)) return
        notifyPhenotypeChanged(caseId)
        setCachedHpoTerms(caseId, (terms) => terms.map((t) => (t.hpo_id === hpoId ? created : t)))
      } catch (error) {
        if (!isCurrentGeneration(generation)) return
        logService.error(
          'Failed to assign HPO term: ' + formatErrorMessage(error, 'Unknown error'),
          'case-metadata'
        )
        setCachedHpoTerms(caseId, () => previousTerms)
        throw error
      }
    })
  }

  // Remove HPO term from case with optimistic update
  async function removeHpoTerm(caseId: number, hpoId: string): Promise<void> {
    if (!api) return
    const generation = cacheGeneration
    await serializeCaseMutation(caseId, generation, async () => {
      const previousTerms = metadataCache.value.get(caseId)?.hpoTerms ?? []
      setCachedHpoTerms(caseId, (terms) => terms.filter((t) => t.hpo_id !== hpoId))

      try {
        unwrapIpcResult(await api.caseMetadata.removeHpoTerm(caseId, hpoId))
        if (!isCurrentGeneration(generation)) return
        notifyPhenotypeChanged(caseId)
      } catch (error) {
        if (!isCurrentGeneration(generation)) return
        logService.error(
          'Failed to remove HPO term: ' + formatErrorMessage(error, 'Unknown error'),
          'case-metadata'
        )
        setCachedHpoTerms(caseId, () => previousTerms)
        throw error
      }
    })
  }

  // Clear all caches (call on database switch)
  function clearCache(): void {
    cacheGeneration += 1
    caseMutationQueues.clear()
    metadataCache.value.clear()
    triggerRef(metadataCache)
    loadingStates.value.clear()
    triggerRef(loadingStates)
    cohortGroupsCache.value = []
  }

  // Evict one case's metadata — call when a case is deleted. Comments and
  // metrics live in the query cache and follow `invalidateServerData`.
  function invalidateCase(caseId: number): void {
    metadataCache.value.delete(caseId)
    triggerCacheUpdate()
    loadingStates.value.delete(caseId)
    triggerRef(loadingStates)
  }

  // Evict every case but keep the cohort groups — call when all cases are
  // deleted.
  function invalidateAllCases(): void {
    metadataCache.value.clear()
    triggerRef(metadataCache)
    loadingStates.value.clear()
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
    invalidateAllCases,
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
