import { contextBridge } from 'electron'
import { createWindowApi } from './window-api/create-window-api'

/**
 * Preload script - exposes typed API to renderer via contextBridge.
 *
 * Channel naming convention: domain:action
 * - cases:list, cases:delete
 * - variants:query, variants:filterOptions
 * - import:selectFile, import:start, import:progress, import:cancel
 * - system:version, system:userDataPath
 * - shell:openExternal
 */

const api = createWindowApi()

// Expose to renderer via contextBridge (secure)
if (process.contextIsolated === true) {
  try {
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    // Console is the only option in preload context (no access to mainLogger/Electron main process)
    console.error('Failed to expose API via contextBridge:', error)
  }
} else {
  // Fallback for non-isolated context (development/testing)
  // @ts-expect-error - window.api defined in global declaration
  window.api = api
}
