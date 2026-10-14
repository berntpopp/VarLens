import type {
  CaseMetadata,
  CaseMetadataUpdates,
  FullCaseMetadata,
  CohortGroup,
  CaseHpoTerm,
  CaseDataInfo,
  CaseDataInfoUpdates,
  CaseExternalId
} from '../../types/api'
import type { IpcResult } from '../../types/errors'
import type { HpoTermFlags } from '../../types/hpo-profile'

export interface CaseMetadataDomainContract {
  get: (caseId: number) => Promise<IpcResult<CaseMetadata | null>>
  upsert: (caseId: number, updates: CaseMetadataUpdates) => Promise<IpcResult<CaseMetadata>>
  listCohorts: () => Promise<IpcResult<CohortGroup[]>>
  createCohort: (name: string, description?: string | null) => Promise<IpcResult<CohortGroup>>
  updateCohort: (
    cohortId: number,
    updates: { name?: string; description?: string | null }
  ) => Promise<IpcResult<CohortGroup>>
  deleteCohort: (cohortId: number) => Promise<IpcResult<void>>
  getCohortByName: (name: string) => Promise<IpcResult<CohortGroup | null>>
  getCaseCohorts: (caseId: number) => Promise<IpcResult<CohortGroup[]>>
  assignCohort: (caseId: number, cohortId: number) => Promise<IpcResult<void>>
  removeCohort: (caseId: number, cohortId: number) => Promise<IpcResult<void>>
  setCohorts: (caseId: number, cohortIds: number[]) => Promise<IpcResult<void>>
  getHpoTerms: (caseId: number) => Promise<IpcResult<CaseHpoTerm[]>>
  assignHpoTerm: (
    caseId: number,
    hpoId: string,
    hpoLabel: string,
    /** Sets the term's status (upsert); omitted: new terms are present, existing keep theirs. */
    flags?: HpoTermFlags
  ) => Promise<IpcResult<CaseHpoTerm>>
  removeHpoTerm: (caseId: number, hpoId: string) => Promise<IpcResult<void>>
  getDataInfo: (caseId: number) => Promise<IpcResult<CaseDataInfo | null>>
  upsertDataInfo: (caseId: number, updates: CaseDataInfoUpdates) => Promise<IpcResult<CaseDataInfo>>
  listExternalIds: (caseId: number) => Promise<IpcResult<CaseExternalId[]>>
  upsertExternalId: (
    caseId: number,
    idType: string,
    idValue: string
  ) => Promise<IpcResult<CaseExternalId>>
  deleteExternalId: (caseId: number, idType: string) => Promise<IpcResult<void>>
  distinctHpoTerms: () => Promise<IpcResult<Array<{ hpo_id: string; hpo_label: string }>>>
  distinctPlatforms: () => Promise<IpcResult<string[]>>
  distinctExternalIdTypes: () => Promise<IpcResult<string[]>>
  getFullMetadata: (caseId: number) => Promise<IpcResult<FullCaseMetadata>>
}
