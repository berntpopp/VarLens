import { contextBridge, ipcRenderer } from 'electron'
import type {
  ProgressUpdate,
  VariantFilter,
  PaginationCursor,
  SortItem,
  BatchProgress,
  DuplicateChoice,
  DuplicateCheckResult,
  CohortSearchParams,
  GlobalAnnotationUpdates,
  PerCaseAnnotationUpdates
} from '../shared/types'

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
  },

  shell: {
    openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
    updateDomains: (domains: string[]) => ipcRenderer.invoke('shell:updateUserDomains', domains)
  },

  database: {
    selectFile: () => ipcRenderer.invoke('database:selectFile'),
    selectSaveLocation: (defaultName: string) =>
      ipcRenderer.invoke('database:selectSaveLocation', defaultName),
    open: (path: string, password?: string) => ipcRenderer.invoke('database:open', path, password),
    create: (path: string, password?: string) =>
      ipcRenderer.invoke('database:create', path, password),
    rekey: (newPassword: string) => ipcRenderer.invoke('database:rekey', newPassword),
    info: () => ipcRenderer.invoke('database:info'),
    recentList: () => ipcRenderer.invoke('database:recentList')
  },

  batchImport: {
    selectFiles: () => ipcRenderer.invoke('batch-import:selectFiles'),
    selectFolder: () => ipcRenderer.invoke('batch-import:selectFolder'),
    checkDuplicates: (filePaths: string[]): Promise<DuplicateCheckResult> =>
      ipcRenderer.invoke('batch-import:checkDuplicates', filePaths),
    start: (filePaths: string[], duplicateStrategy: DuplicateChoice) =>
      ipcRenderer.invoke('batch-import:start', filePaths, duplicateStrategy),
    cancel: () => ipcRenderer.invoke('batch-import:cancel'),

    selectZip: () => ipcRenderer.invoke('batch-import:selectZip'),
    testZipPassword: (zipPath: string, password: string) =>
      ipcRenderer.invoke('batch-import:testZipPassword', zipPath, password),
    extractZip: (zipPath: string, password?: string) =>
      ipcRenderer.invoke('batch-import:extractZip', zipPath, password),
    cleanupZipTemp: () => ipcRenderer.invoke('batch-import:cleanupZipTemp'),

    onProgress: (callback: (progress: BatchProgress) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, progress: BatchProgress) => {
        callback(progress)
      }
      ipcRenderer.on('batch-import:progress', handler)
      return () => {
        ipcRenderer.removeListener('batch-import:progress', handler)
      }
    }
  },

  cohort: {
    getVariants: (params: CohortSearchParams) => ipcRenderer.invoke('cohort:variants', params),
    getSummary: () => ipcRenderer.invoke('cohort:summary'),
    getCarriers: (chr: string, pos: number, ref: string, alt: string) =>
      ipcRenderer.invoke('cohort:carriers', chr, pos, ref, alt),
    getGeneBurden: () => ipcRenderer.invoke('cohort:geneBurden')
  },

  annotations: {
    getGlobal: (chr: string, pos: number, ref: string, alt: string) =>
      ipcRenderer.invoke('annotations:getGlobal', chr, pos, ref, alt),

    upsertGlobal: (
      chr: string,
      pos: number,
      ref: string,
      alt: string,
      updates: GlobalAnnotationUpdates
    ) => ipcRenderer.invoke('annotations:upsertGlobal', chr, pos, ref, alt, updates),

    deleteGlobal: (chr: string, pos: number, ref: string, alt: string) =>
      ipcRenderer.invoke('annotations:deleteGlobal', chr, pos, ref, alt),

    getPerCase: (caseId: number, variantId: number) =>
      ipcRenderer.invoke('annotations:getPerCase', caseId, variantId),

    upsertPerCase: (caseId: number, variantId: number, updates: PerCaseAnnotationUpdates) =>
      ipcRenderer.invoke('annotations:upsertPerCase', caseId, variantId, updates),

    deletePerCase: (caseId: number, variantId: number) =>
      ipcRenderer.invoke('annotations:deletePerCase', caseId, variantId),

    getForVariant: (caseId: number, chr: string, pos: number, ref: string, alt: string) =>
      ipcRenderer.invoke('annotations:getForVariant', caseId, chr, pos, ref, alt)
  },

  vep: {
    fetch: (chr: string, pos: number, ref: string, alt: string) =>
      ipcRenderer.invoke('vep:fetch', chr, pos, ref, alt),
    cancel: () => ipcRenderer.invoke('vep:cancel'),
    clearCache: () => ipcRenderer.invoke('vep:clearCache'),
    getCacheStats: () => ipcRenderer.invoke('vep:getCacheStats')
  },

  hpo: {
    search: (query: string, maxResults?: number) =>
      ipcRenderer.invoke('hpo:search', query, maxResults),
    clearCache: () => ipcRenderer.invoke('hpo:clearCache')
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
