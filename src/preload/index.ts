import { contextBridge, ipcRenderer } from 'electron'
import type { ProgressUpdate, VariantFilter, PaginationCursor, SortItem } from '../shared/types'

/**
 * Preload script - exposes typed API to renderer via contextBridge.
 *
 * Channel naming convention: domain:action
 * - cases:list, cases:delete
 * - variants:query, variants:filterOptions
 * - import:selectFile, import:start, import:progress, import:cancel
 * - system:version, system:userDataPath
 */

const api = {
  cases: {
    list: () => ipcRenderer.invoke('cases:list'),
    delete: (id: number) => ipcRenderer.invoke('cases:delete', id)
  },

  variants: {
    query: (
      caseId: number,
      filters: Omit<VariantFilter, 'case_id'>,
      cursor?: PaginationCursor,
      limit?: number,
      sortBy?: SortItem[]
    ) => ipcRenderer.invoke('variants:query', caseId, filters, cursor, limit, sortBy),

    getFilterOptions: (caseId: number) => ipcRenderer.invoke('variants:filterOptions', caseId),

    search: (caseId: number, query: string, limit?: number) =>
      ipcRenderer.invoke('variants:search', caseId, query, limit ?? 20)
  },

  import: {
    selectFile: () => ipcRenderer.invoke('import:selectFile'),

    start: (filePath: string, caseName: string) =>
      ipcRenderer.invoke('import:start', filePath, caseName),

    /**
     * Register progress listener. Returns cleanup function.
     * IMPORTANT: Call the returned function on component unmount to prevent memory leaks.
     */
    onProgress: (callback: (progress: ProgressUpdate) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, progress: ProgressUpdate) => {
        callback(progress)
      }
      ipcRenderer.on('import:progress', handler)

      // Return cleanup function
      return () => {
        ipcRenderer.removeListener('import:progress', handler)
      }
    },

    cancel: () => ipcRenderer.invoke('import:cancel')
  },

  system: {
    getVersion: () => ipcRenderer.invoke('system:version'),
    getUserDataPath: () => ipcRenderer.invoke('system:userDataPath')
  },

  export: {
    variants: (caseId: number, filters: Omit<VariantFilter, 'case_id'>, caseName: string) =>
      ipcRenderer.invoke('export:variants', caseId, filters, caseName)
  }
}

// Expose to renderer via contextBridge (secure)
if (process.contextIsolated === true) {
  try {
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error('Failed to expose API via contextBridge:', error)
  }
} else {
  // Fallback for non-isolated context (development/testing)
  // @ts-expect-error - window.api defined in global declaration
  window.api = api
}
