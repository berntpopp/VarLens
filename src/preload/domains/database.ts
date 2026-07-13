import { ipcRenderer } from 'electron'
import type { DatabaseDomainContract } from '../../shared/ipc/domains/database'

export function createDatabaseApi(): DatabaseDomainContract {
  return {
    selectFile: () => ipcRenderer.invoke('database:selectFile'),
    selectSaveLocation: (defaultName) =>
      ipcRenderer.invoke('database:selectSaveLocation', defaultName),
    open: (path, password) => ipcRenderer.invoke('database:open', path, password),
    create: (path, password, setupPassphrase) =>
      ipcRenderer.invoke('database:create', path, password, setupPassphrase),
    rekey: (newPassword) => ipcRenderer.invoke('database:rekey', newPassword),
    migrateToEncrypted: (options) => ipcRenderer.invoke('database:migrateToEncrypted', options),
    deletePlaintextBackup: (backupPath) =>
      ipcRenderer.invoke('database:deletePlaintextBackup', backupPath),
    setRecoveryPassphrase: (passphrase) =>
      ipcRenderer.invoke('database:setRecoveryPassphrase', passphrase),
    info: () => ipcRenderer.invoke('database:info'),
    capabilities: () => ipcRenderer.invoke('database:capabilities'),
    postgresDiagnostics: () => ipcRenderer.invoke('database:postgresDiagnostics'),
    postgresProfilesList: () => ipcRenderer.invoke('database:postgresProfilesList'),
    postgresProfileSave: (input) => ipcRenderer.invoke('database:postgresProfileSave', input),
    postgresProfileRemove: (profileId) =>
      ipcRenderer.invoke('database:postgresProfileRemove', profileId),
    postgresProfileTest: (input) => ipcRenderer.invoke('database:postgresProfileTest', input),
    postgresProfileOpen: (profileId) =>
      ipcRenderer.invoke('database:postgresProfileOpen', profileId),
    recentList: () => ipcRenderer.invoke('database:recentList'),
    getOverview: () => ipcRenderer.invoke('database:overview'),
    removeRecent: (path) => ipcRenderer.invoke('database:removeRecent', path),
    deleteFile: (path) => ipcRenderer.invoke('database:deleteFile', path),
    showInFolder: (path) => ipcRenderer.invoke('database:showInFolder', path)
  }
}
