/**
 * Pure business logic for case-metadata IPC handlers.
 *
 * All functions take an explicit storage session dependency and never touch
 * IPC/Electron APIs directly. This makes them testable without mocking
 * Electron internals.
 */
import type { HpoTermFlags } from '../../../shared/types/hpo-profile'
import type { StorageSession } from '../../storage/session'
import type {
  CohortCreateParams,
  CohortUpdateParams,
  DataInfoUpdates,
  MetadataUpdates
} from '../../storage/case-metadata-types'

// ============================================================
// Case Metadata
// ============================================================

/**
 * Get case metadata.
 */
export async function getMetadata(
  caseId: number,
  getSession: () => StorageSession
): Promise<unknown> {
  return await getSession()
    .getReadExecutor()
    .execute({
      type: 'case-metadata:get',
      params: [caseId]
    })
}

/**
 * Upsert case metadata.
 */
export async function upsertMetadata(
  caseId: number,
  updates: MetadataUpdates,
  getSession: () => StorageSession
): Promise<unknown> {
  return await getSession()
    .getWriteExecutor()
    .execute({
      type: 'case-metadata:upsert',
      params: [caseId, updates]
    })
}

// ============================================================
// Cohort Groups
// ============================================================

/**
 * List all cohort groups.
 */
export async function listCohorts(getSession: () => StorageSession): Promise<unknown> {
  return await getSession().getReadExecutor().execute({
    type: 'case-metadata:listCohorts',
    params: []
  })
}

/**
 * Create a new cohort group.
 */
export async function createCohort(
  params: CohortCreateParams,
  getSession: () => StorageSession
): Promise<unknown> {
  return await getSession()
    .getWriteExecutor()
    .execute({
      type: 'case-metadata:createCohort',
      params: [params]
    })
}

/**
 * Update a cohort group.
 */
export async function updateCohort(
  cohortId: number,
  updates: CohortUpdateParams,
  getSession: () => StorageSession
): Promise<unknown> {
  return await getSession()
    .getWriteExecutor()
    .execute({
      type: 'case-metadata:updateCohort',
      params: [cohortId, updates]
    })
}

/**
 * Delete a cohort group.
 */
export async function deleteCohort(
  cohortId: number,
  getSession: () => StorageSession
): Promise<unknown> {
  return await getSession()
    .getWriteExecutor()
    .execute({
      type: 'case-metadata:deleteCohort',
      params: [cohortId]
    })
}

/**
 * Get cohort group by name.
 */
export async function getCohortByName(
  name: string,
  getSession: () => StorageSession
): Promise<unknown> {
  return await getSession()
    .getReadExecutor()
    .execute({
      type: 'case-metadata:getCohortByName',
      params: [name]
    })
}

// ============================================================
// Case-Cohort Links
// ============================================================

/**
 * Get all cohorts for a case.
 */
export async function getCaseCohorts(
  caseId: number,
  getSession: () => StorageSession
): Promise<unknown> {
  return await getSession()
    .getReadExecutor()
    .execute({
      type: 'case-metadata:getCaseCohorts',
      params: [caseId]
    })
}

/**
 * Assign a case to a cohort.
 */
export async function assignCohort(
  caseId: number,
  cohortId: number,
  getSession: () => StorageSession
): Promise<unknown> {
  return await getSession()
    .getWriteExecutor()
    .execute({
      type: 'case-metadata:assignCohort',
      params: [caseId, cohortId]
    })
}

/**
 * Remove a case from a cohort.
 */
export async function removeCohort(
  caseId: number,
  cohortId: number,
  getSession: () => StorageSession
): Promise<unknown> {
  return await getSession()
    .getWriteExecutor()
    .execute({
      type: 'case-metadata:removeCohort',
      params: [caseId, cohortId]
    })
}

/**
 * Replace all cohort assignments for a case.
 */
export async function setCohorts(
  caseId: number,
  cohortIds: number[],
  getSession: () => StorageSession
): Promise<unknown> {
  return await getSession()
    .getWriteExecutor()
    .execute({
      type: 'case-metadata:setCohorts',
      params: [caseId, cohortIds]
    })
}

// ============================================================
// HPO Terms
// ============================================================

/**
 * Get all HPO terms for a case.
 */
export async function getHpoTerms(
  caseId: number,
  getSession: () => StorageSession
): Promise<unknown> {
  return await getSession()
    .getReadExecutor()
    .execute({
      type: 'case-metadata:getHpoTerms',
      params: [caseId]
    })
}

/**
 * Assign (upsert) an HPO term; `flags` set its status (see MetadataRepository.assignCaseHpoTerm).
 */
export async function assignHpoTerm(
  caseId: number,
  hpoId: string,
  hpoLabel: string,
  getSession: () => StorageSession,
  flags?: HpoTermFlags
): Promise<unknown> {
  return await getSession()
    .getWriteExecutor()
    .execute({
      type: 'case-metadata:assignHpoTerm',
      params: flags === undefined ? [caseId, hpoId, hpoLabel] : [caseId, hpoId, hpoLabel, flags]
    })
}

/**
 * Remove HPO term from case.
 */
export async function removeHpoTerm(
  caseId: number,
  hpoId: string,
  getSession: () => StorageSession
): Promise<unknown> {
  return await getSession()
    .getWriteExecutor()
    .execute({
      type: 'case-metadata:removeHpoTerm',
      params: [caseId, hpoId]
    })
}

// ============================================================
// Case Data Info
// ============================================================

/**
 * Get case data info (import provenance, platform, pre-filtering).
 */
export async function getDataInfo(
  caseId: number,
  getSession: () => StorageSession
): Promise<unknown> {
  return await getSession()
    .getReadExecutor()
    .execute({
      type: 'case-metadata:getDataInfo',
      params: [caseId]
    })
}

/**
 * Upsert case data info.
 */
export async function upsertDataInfo(
  caseId: number,
  updates: DataInfoUpdates,
  getSession: () => StorageSession
): Promise<unknown> {
  return await getSession()
    .getWriteExecutor()
    .execute({
      type: 'case-metadata:upsertDataInfo',
      params: [caseId, updates]
    })
}

// ============================================================
// External IDs
// ============================================================

/**
 * List external IDs for a case.
 */
export async function listExternalIds(
  caseId: number,
  getSession: () => StorageSession
): Promise<unknown> {
  return await getSession()
    .getReadExecutor()
    .execute({
      type: 'case-metadata:listExternalIds',
      params: [caseId]
    })
}

/**
 * Upsert an external ID for a case.
 */
export async function upsertExternalId(
  caseId: number,
  idType: string,
  idValue: string,
  getSession: () => StorageSession
): Promise<unknown> {
  return await getSession()
    .getWriteExecutor()
    .execute({
      type: 'case-metadata:upsertExternalId',
      params: [caseId, idType, idValue]
    })
}

/**
 * Delete an external ID for a case.
 */
export async function deleteExternalId(
  caseId: number,
  idType: string,
  getSession: () => StorageSession
): Promise<unknown> {
  return await getSession()
    .getWriteExecutor()
    .execute({
      type: 'case-metadata:deleteExternalId',
      params: [caseId, idType]
    })
}

// ============================================================
// Distinct Lookups
// ============================================================

/**
 * Get distinct HPO terms across all cases.
 */
export async function distinctHpoTerms(getSession: () => StorageSession): Promise<unknown> {
  return await getSession().getReadExecutor().execute({
    type: 'case-metadata:distinctHpoTerms',
    params: []
  })
}

/**
 * Get distinct platforms across all cases.
 */
export async function distinctPlatforms(getSession: () => StorageSession): Promise<unknown> {
  return await getSession().getReadExecutor().execute({
    type: 'case-metadata:distinctPlatforms',
    params: []
  })
}

/**
 * Get distinct external ID types across all cases.
 */
export async function distinctExternalIdTypes(getSession: () => StorageSession): Promise<unknown> {
  return await getSession().getReadExecutor().execute({
    type: 'case-metadata:distinctExternalIdTypes',
    params: []
  })
}

// ============================================================
// Convenience
// ============================================================

/**
 * Get full metadata for a case (metadata + cohorts + HPO terms).
 */
export async function getFullMetadata(
  caseId: number,
  getSession: () => StorageSession
): Promise<unknown> {
  return await getSession()
    .getReadExecutor()
    .execute({
      type: 'case-metadata:getFullMetadata',
      params: [caseId]
    })
}
