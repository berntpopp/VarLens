import { ipcRenderer } from 'electron'
import type { AuthDomainContract } from '../../shared/ipc/domains/auth'

export function createAuthApi(): AuthDomainContract {
  return {
    login: (username, password) => ipcRenderer.invoke('auth:login', username, password),
    logout: () => ipcRenderer.invoke('auth:logout'),
    currentUser: () => ipcRenderer.invoke('auth:currentUser'),
    isAccountsEnabled: () => ipcRenderer.invoke('auth:isAccountsEnabled'),
    createUser: (username, displayName, tempPassword) =>
      ipcRenderer.invoke('auth:createUser', username, displayName, tempPassword),
    listUsers: () => ipcRenderer.invoke('auth:listUsers'),
    deactivateUser: (username) => ipcRenderer.invoke('auth:deactivateUser', username),
    reactivateUser: (username) => ipcRenderer.invoke('auth:reactivateUser', username),
    setRole: (username, role) => ipcRenderer.invoke('auth:setRole', username, role),
    resetPassword: (username, newPassword) =>
      ipcRenderer.invoke('auth:resetPassword', username, newPassword),
    changePassword: (oldPassword, newPassword) =>
      ipcRenderer.invoke('auth:changePassword', oldPassword, newPassword)
  }
}
