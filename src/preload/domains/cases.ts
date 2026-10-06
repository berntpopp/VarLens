import { ipcRenderer } from 'electron'
import type { CasesDomainContract } from '../../shared/ipc/domains/cases'

export function createCasesApi(): CasesDomainContract {
  return {
    list: () => ipcRenderer.invoke('cases:list'),
    query: (params) => ipcRenderer.invoke('cases:query', params),
    delete: (id) => ipcRenderer.invoke('cases:delete', id),
    deleteAll: () => ipcRenderer.invoke('cases:deleteAll'),
    deleteBatch: (ids) => ipcRenderer.invoke('cases:deleteBatch', ids),
    startDelete: (target) => ipcRenderer.invoke('cases:startDelete', target),
    availableBuilds: () => ipcRenderer.invoke('cases:availableBuilds')
  }
}
