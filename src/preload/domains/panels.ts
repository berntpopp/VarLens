import { ipcRenderer } from 'electron'
import type { PanelsDomainContract } from '../../shared/ipc/domains/panels'

export function createPanelsApi(): PanelsDomainContract {
  return {
    list: () => ipcRenderer.invoke('panels:list'),
    get: (id) => ipcRenderer.invoke('panels:get', id),
    create: (params) => ipcRenderer.invoke('panels:create', params),
    update: (params) => ipcRenderer.invoke('panels:update', params),
    delete: (id) => ipcRenderer.invoke('panels:delete', id),
    duplicate: (id, newName) => ipcRenderer.invoke('panels:duplicate', { id, newName }),
    setGenes: (panelId, genes) => ipcRenderer.invoke('panels:setGenes', { panelId, genes }),
    getGenes: (panelId) => ipcRenderer.invoke('panels:getGenes', panelId),
    activate: (caseId, panelId, paddingBp) =>
      ipcRenderer.invoke('panels:activate', { caseId, panelId, paddingBp }),
    deactivate: (caseId, panelId) => ipcRenderer.invoke('panels:deactivate', { caseId, panelId }),
    activeForCase: (caseId) => ipcRenderer.invoke('panels:active-for-case', caseId),
    resolutionStatus: (request) => ipcRenderer.invoke('panels:resolutionStatus', request),
    validateSymbols: (symbols) => ipcRenderer.invoke('panels:validate-symbols', { symbols }),
    autocomplete: (query, limit) => ipcRenderer.invoke('panels:autocomplete', { query, limit }),
    searchPanelApp: (keyword, region) =>
      ipcRenderer.invoke('panels:search-panelapp', { keyword, region }),
    importPanelApp: (params) => ipcRenderer.invoke('panels:import-panelapp', params),
    generateStringDb: (params) => ipcRenderer.invoke('panels:generate-stringdb', params),
    exportBed: (panelId, assembly, paddingBp) =>
      ipcRenderer.invoke('panels:export-bed', panelId, assembly, paddingBp)
  }
}
