import { ipcRenderer } from 'electron'
import type { BatchImportDomainContract } from '../../shared/ipc/domains/batch-import'

export function createBatchImportApi(): BatchImportDomainContract {
  return {
    selectFiles: () => ipcRenderer.invoke('batch-import:selectFiles'),
    selectFolder: () => ipcRenderer.invoke('batch-import:selectFolder'),
    checkDuplicates: (filePaths, stripText) =>
      ipcRenderer.invoke('batch-import:checkDuplicates', filePaths, stripText),
    start: (filePaths, duplicateStrategy, stripText, runId) =>
      ipcRenderer.invoke('batch-import:start', filePaths, duplicateStrategy, stripText, runId),
    cancel: () => ipcRenderer.invoke('batch-import:cancel'),
    selectZip: () => ipcRenderer.invoke('batch-import:selectZip'),
    testZipPassword: (zipPath, password) =>
      ipcRenderer.invoke('batch-import:testZipPassword', zipPath, password),
    extractZip: (zipPath, password) =>
      ipcRenderer.invoke('batch-import:extractZip', zipPath, password),
    cleanupZipTemp: (extractionId) =>
      ipcRenderer.invoke('batch-import:cleanupZipTemp', extractionId)
  }
}
