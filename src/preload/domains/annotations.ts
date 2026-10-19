import { ipcRenderer } from 'electron'
import type { AnnotationsDomainContract } from '../../shared/ipc/domains/annotations'

export function createAnnotationsApi(): AnnotationsDomainContract {
  return {
    getGlobal: (chr, pos, ref, alt, genomeBuild) =>
      ipcRenderer.invoke('annotations:getGlobal', chr, pos, ref, alt, genomeBuild),
    upsertGlobal: (chr, pos, ref, alt, updates, genomeBuild) =>
      ipcRenderer.invoke('annotations:upsertGlobal', chr, pos, ref, alt, updates, genomeBuild),
    deleteGlobal: (chr, pos, ref, alt, genomeBuild) =>
      ipcRenderer.invoke('annotations:deleteGlobal', chr, pos, ref, alt, genomeBuild),
    getPerCase: (caseId, variantId) =>
      ipcRenderer.invoke('annotations:getPerCase', caseId, variantId),
    upsertPerCase: (caseId, variantId, updates) =>
      ipcRenderer.invoke('annotations:upsertPerCase', caseId, variantId, updates),
    batchUpsertPerCase: (caseId, variantIds, updates) =>
      ipcRenderer.invoke('annotations:batchUpsertPerCase', caseId, variantIds, updates),
    deletePerCase: (caseId, variantId) =>
      ipcRenderer.invoke('annotations:deletePerCase', caseId, variantId),
    getForVariant: (caseId, chr, pos, ref, alt) =>
      ipcRenderer.invoke('annotations:getForVariant', caseId, chr, pos, ref, alt),
    batchGet: (caseId, variantKeys, genomeBuild) =>
      ipcRenderer.invoke('annotations:batchGet', caseId, variantKeys, genomeBuild)
  }
}
