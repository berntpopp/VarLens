import { ipcRenderer } from 'electron'
import type { ExportDomainContract } from '../../shared/ipc/domains/export'

export function createExportApi(): ExportDomainContract {
  return {
    variants: (caseId, filters, caseName) =>
      ipcRenderer.invoke('export:variants', caseId, filters, caseName),
    cohort: (params) => ipcRenderer.invoke('export:cohort', params),
    revealInFolder: (filePath) => ipcRenderer.invoke('export:revealInFolder', filePath)
  }
}
