import { ipcRenderer } from 'electron'
import type { CaseMetadataDomainContract } from '../../shared/ipc/domains/case-metadata'

export function createCaseMetadataApi(): CaseMetadataDomainContract {
  return {
    get: (caseId) => ipcRenderer.invoke('case-metadata:get', caseId),
    upsert: (caseId, updates) => ipcRenderer.invoke('case-metadata:upsert', caseId, updates),
    listCohorts: () => ipcRenderer.invoke('case-metadata:listCohorts'),
    createCohort: (name, description) =>
      ipcRenderer.invoke('case-metadata:createCohort', name, description),
    updateCohort: (cohortId, updates) =>
      ipcRenderer.invoke('case-metadata:updateCohort', cohortId, updates),
    deleteCohort: (cohortId) => ipcRenderer.invoke('case-metadata:deleteCohort', cohortId),
    getCohortByName: (name) => ipcRenderer.invoke('case-metadata:getCohortByName', name),
    getCaseCohorts: (caseId) => ipcRenderer.invoke('case-metadata:getCaseCohorts', caseId),
    assignCohort: (caseId, cohortId) =>
      ipcRenderer.invoke('case-metadata:assignCohort', caseId, cohortId),
    removeCohort: (caseId, cohortId) =>
      ipcRenderer.invoke('case-metadata:removeCohort', caseId, cohortId),
    setCohorts: (caseId, cohortIds) =>
      ipcRenderer.invoke('case-metadata:setCohorts', caseId, cohortIds),
    getHpoTerms: (caseId) => ipcRenderer.invoke('case-metadata:getHpoTerms', caseId),
    assignHpoTerm: (caseId, hpoId, hpoLabel, flags) =>
      ipcRenderer.invoke('case-metadata:assignHpoTerm', caseId, hpoId, hpoLabel, flags),
    removeHpoTerm: (caseId, hpoId) =>
      ipcRenderer.invoke('case-metadata:removeHpoTerm', caseId, hpoId),
    getDataInfo: (caseId) => ipcRenderer.invoke('case-metadata:getDataInfo', caseId),
    upsertDataInfo: (caseId, updates) =>
      ipcRenderer.invoke('case-metadata:upsertDataInfo', caseId, updates),
    listExternalIds: (caseId) => ipcRenderer.invoke('case-metadata:listExternalIds', caseId),
    upsertExternalId: (caseId, idType, idValue) =>
      ipcRenderer.invoke('case-metadata:upsertExternalId', caseId, idType, idValue),
    deleteExternalId: (caseId, idType) =>
      ipcRenderer.invoke('case-metadata:deleteExternalId', caseId, idType),
    distinctHpoTerms: () => ipcRenderer.invoke('case-metadata:distinctHpoTerms'),
    distinctPlatforms: () => ipcRenderer.invoke('case-metadata:distinctPlatforms'),
    distinctExternalIdTypes: () => ipcRenderer.invoke('case-metadata:distinctExternalIdTypes'),
    getFullMetadata: (caseId) => ipcRenderer.invoke('case-metadata:getFullMetadata', caseId)
  }
}
