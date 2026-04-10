import { contextBridge, ipcRenderer } from 'electron'
import type {
  ProgressUpdate,
  VariantFilter,
  SortItem,
  BatchProgress,
  BatchResult,
  DuplicateChoice,
  DuplicateCheckResult,
  CohortSearchParams,
  GlobalAnnotationUpdates,
  PerCaseAnnotationUpdates,
  CaseMetadataUpdates,
  CaseSearchParams,
  LogMessage
} from '../shared/types'
import type { CommentCategory } from '../shared/types/api'

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
    query: (params: CaseSearchParams) => ipcRenderer.invoke('cases:query', params),
    delete: (id: number) => ipcRenderer.invoke('cases:delete', id),
    deleteAll: (): Promise<number> => ipcRenderer.invoke('cases:deleteAll'),
    deleteBatch: (ids: number[]): Promise<number> => ipcRenderer.invoke('cases:deleteBatch', ids)
  },

  variants: {
    query: (
      caseId: number,
      filters: Omit<VariantFilter, 'case_id'>,
      offset?: number,
      limit?: number,
      sortBy?: SortItem[],
      skipCount?: boolean,
      includeUnfilteredCount?: boolean
    ) =>
      ipcRenderer.invoke(
        'variants:query',
        caseId,
        filters,
        offset,
        limit,
        sortBy,
        skipCount,
        includeUnfilteredCount
      ),

    getFilterOptions: (caseId: number) => ipcRenderer.invoke('variants:filterOptions', caseId),

    search: (caseId: number, query: string, limit?: number) =>
      ipcRenderer.invoke('variants:search', caseId, query, limit ?? 20),

    /** Get gene symbols for autocomplete (optimized LIKE query - faster than FTS5) */
    geneSymbols: (caseId: number, query: string, limit?: number) =>
      ipcRenderer.invoke('variants:geneSymbols', caseId, query, limit ?? 50),

    /** Get variant type counts per case for tab badges (snv/indel/sv/cnv/str) */
    typeCounts: (caseId: number) => ipcRenderer.invoke('variants:typeCounts', caseId)
  },

  import: {
    selectFile: () => ipcRenderer.invoke('import:selectFile'),

    start: (
      filePath: string,
      caseName: string,
      vcfOptions?: { selectedSample?: string; genomeBuild?: string }
    ) => ipcRenderer.invoke('import:start', filePath, caseName, vcfOptions),

    vcfPreview: (filePath: string) => ipcRenderer.invoke('import:vcfPreview', filePath),

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
    getUserDataPath: () => ipcRenderer.invoke('system:userDataPath'),
    getCpuCount: (): Promise<number> => ipcRenderer.invoke('system:getCpuCount'),
    setWorkerThreads: (count: number): Promise<void> =>
      ipcRenderer.invoke('system:setWorkerThreads', count),
    getWorkerThreads: (): Promise<number> => ipcRenderer.invoke('system:getWorkerThreads'),
    getLogFilePath: (): Promise<string> => ipcRenderer.invoke('system:logFilePath')
  },

  export: {
    variants: (caseId: number, filters: Omit<VariantFilter, 'case_id'>, caseName: string) =>
      ipcRenderer.invoke('export:variants', caseId, filters, caseName),
    cohort: (params: CohortSearchParams) => ipcRenderer.invoke('export:cohort', params)
  },

  shell: {
    openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
    updateDomains: (domains: string[]) => ipcRenderer.invoke('shell:updateUserDomains', domains),
    showItemInFolder: (filePath: string) => ipcRenderer.invoke('shell:showItemInFolder', filePath)
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
    recentList: () => ipcRenderer.invoke('database:recentList'),
    getOverview: () => ipcRenderer.invoke('database:overview'),
    removeRecent: (path: string) => ipcRenderer.invoke('database:removeRecent', path),
    deleteFile: (path: string) => ipcRenderer.invoke('database:deleteFile', path),
    showInFolder: (path: string) => ipcRenderer.invoke('database:showInFolder', path)
  },

  batchImport: {
    selectFiles: () => ipcRenderer.invoke('batch-import:selectFiles'),
    selectFolder: () => ipcRenderer.invoke('batch-import:selectFolder'),
    checkDuplicates: (filePaths: string[], stripText?: string): Promise<DuplicateCheckResult> =>
      ipcRenderer.invoke('batch-import:checkDuplicates', filePaths, stripText),
    start: (filePaths: string[], duplicateStrategy: DuplicateChoice, stripText?: string) =>
      ipcRenderer.invoke('batch-import:start', filePaths, duplicateStrategy, stripText),
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
    },

    onComplete: (callback: (result: BatchResult) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, result: BatchResult) => {
        callback(result)
      }
      ipcRenderer.on('batch-import:complete', handler)
      return () => {
        ipcRenderer.removeListener('batch-import:complete', handler)
      }
    }
  },

  cohort: {
    getVariants: (params: CohortSearchParams) => ipcRenderer.invoke('cohort:variants', params),
    getColumnMeta: () => ipcRenderer.invoke('cohort:columnMeta'),
    getSummary: () => ipcRenderer.invoke('cohort:summary'),
    getCarriers: (chr: string, pos: number, ref: string, alt: string) =>
      ipcRenderer.invoke('cohort:carriers', chr, pos, ref, alt),
    getGeneBurden: () => ipcRenderer.invoke('cohort:geneBurden'),
    runAssociation: (config: unknown) => ipcRenderer.invoke('cohort:geneBurdenCompare', config),
    cancelAssociation: () => ipcRenderer.invoke('cohort:geneBurdenCancel'),
    onAssociationProgress: (
      callback: (progress: { completed: number; total: number }) => void
    ): (() => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        progress: { completed: number; total: number }
      ): void => {
        callback(progress)
      }
      ipcRenderer.on('cohort:geneBurdenProgress', handler)
      return () => {
        ipcRenderer.removeListener('cohort:geneBurdenProgress', handler)
      }
    },
    getSummaryStatus: () => ipcRenderer.invoke('cohort:summaryStatus'),
    rebuildSummary: () => ipcRenderer.invoke('cohort:rebuildSummary'),
    onSummaryRebuilt: (callback: (status: { is_stale: boolean }) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, status: { is_stale: boolean }): void => {
        callback(status)
      }
      ipcRenderer.on('cohort:summaryRebuilt', handler)
      return () => {
        ipcRenderer.removeListener('cohort:summaryRebuilt', handler)
      }
    }
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
      ipcRenderer.invoke('annotations:getForVariant', caseId, chr, pos, ref, alt),

    batchGet: (
      caseId: number | null,
      variantKeys: Array<{ chr: string; pos: number; ref: string; alt: string }>
    ) => ipcRenderer.invoke('annotations:batchGet', caseId, variantKeys)
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
  },

  myvariant: {
    fetch: (chr: string, pos: number, ref: string, alt: string) =>
      ipcRenderer.invoke('myvariant:fetch', chr, pos, ref, alt),
    clearCache: () => ipcRenderer.invoke('myvariant:clearCache')
  },

  spliceai: {
    fetch: (chr: string, pos: number, ref: string, alt: string) =>
      ipcRenderer.invoke('spliceai:fetch', chr, pos, ref, alt),
    clearCache: () => ipcRenderer.invoke('spliceai:clearCache')
  },

  caseMetadata: {
    get: (caseId: number) => ipcRenderer.invoke('case-metadata:get', caseId),

    upsert: (caseId: number, updates: CaseMetadataUpdates) =>
      ipcRenderer.invoke('case-metadata:upsert', caseId, updates),

    getFullMetadata: (caseId: number) =>
      ipcRenderer.invoke('case-metadata:getFullMetadata', caseId),

    // Cohort groups
    listCohorts: () => ipcRenderer.invoke('case-metadata:listCohorts'),

    createCohort: (name: string, description?: string | null) =>
      ipcRenderer.invoke('case-metadata:createCohort', name, description),

    updateCohort: (cohortId: number, updates: { name?: string; description?: string | null }) =>
      ipcRenderer.invoke('case-metadata:updateCohort', cohortId, updates),

    deleteCohort: (cohortId: number) => ipcRenderer.invoke('case-metadata:deleteCohort', cohortId),

    getCohortByName: (name: string) => ipcRenderer.invoke('case-metadata:getCohortByName', name),

    // Case-cohort links
    getCaseCohorts: (caseId: number) => ipcRenderer.invoke('case-metadata:getCaseCohorts', caseId),

    assignCohort: (caseId: number, cohortId: number) =>
      ipcRenderer.invoke('case-metadata:assignCohort', caseId, cohortId),

    removeCohort: (caseId: number, cohortId: number) =>
      ipcRenderer.invoke('case-metadata:removeCohort', caseId, cohortId),

    setCohorts: (caseId: number, cohortIds: number[]) =>
      ipcRenderer.invoke('case-metadata:setCohorts', caseId, cohortIds),

    // HPO terms
    getHpoTerms: (caseId: number) => ipcRenderer.invoke('case-metadata:getHpoTerms', caseId),

    assignHpoTerm: (caseId: number, hpoId: string, hpoLabel: string) =>
      ipcRenderer.invoke('case-metadata:assignHpoTerm', caseId, hpoId, hpoLabel),

    removeHpoTerm: (caseId: number, hpoId: string) =>
      ipcRenderer.invoke('case-metadata:removeHpoTerm', caseId, hpoId),

    // Data info (import provenance, platform, pre-filtering)
    getDataInfo: (caseId: number) => ipcRenderer.invoke('case-metadata:getDataInfo', caseId),

    upsertDataInfo: (
      caseId: number,
      updates: {
        platform?: string | null
        platform_details?: string | null
        af_filter?: string | null
        gene_list_filter?: string | null
        region_filter?: string | null
        quality_filter?: string | null
        data_notes?: string | null
        gene_list_id?: number | null
        region_file_id?: number | null
      }
    ) => ipcRenderer.invoke('case-metadata:upsertDataInfo', caseId, updates),

    // External IDs (user-defined key-value cross-references)
    listExternalIds: (caseId: number) =>
      ipcRenderer.invoke('case-metadata:listExternalIds', caseId),

    upsertExternalId: (caseId: number, idType: string, idValue: string) =>
      ipcRenderer.invoke('case-metadata:upsertExternalId', caseId, idType, idValue),

    deleteExternalId: (caseId: number, idType: string) =>
      ipcRenderer.invoke('case-metadata:deleteExternalId', caseId, idType),

    distinctHpoTerms: (): Promise<Array<{ hpo_id: string; hpo_label: string }>> =>
      ipcRenderer.invoke('case-metadata:distinctHpoTerms'),
    distinctPlatforms: () => ipcRenderer.invoke('case-metadata:distinctPlatforms'),
    distinctExternalIdTypes: () => ipcRenderer.invoke('case-metadata:distinctExternalIdTypes')
  },

  caseComments: {
    list: (caseId: number) => ipcRenderer.invoke('case-comments:list', caseId),

    create: (caseId: number, category: CommentCategory, content: string) =>
      ipcRenderer.invoke('case-comments:create', caseId, category, content),

    update: (commentId: number, content: string) =>
      ipcRenderer.invoke('case-comments:update', commentId, content),

    delete: (commentId: number) => ipcRenderer.invoke('case-comments:delete', commentId)
  },

  caseMetrics: {
    listDefinitions: () => ipcRenderer.invoke('case-metrics:listDefinitions'),

    createDefinition: (
      name: string,
      valueType: 'numeric' | 'text' | 'date',
      unit: string,
      category: string
    ) => ipcRenderer.invoke('case-metrics:createDefinition', name, valueType, unit, category),

    listForCase: (caseId: number) => ipcRenderer.invoke('case-metrics:listForCase', caseId),

    upsert: (
      caseId: number,
      metricId: number,
      value: {
        numeric_value?: number | null
        text_value?: string | null
        date_value?: string | null
      }
    ) => ipcRenderer.invoke('case-metrics:upsert', caseId, metricId, value),

    delete: (caseId: number, metricId: number) =>
      ipcRenderer.invoke('case-metrics:delete', caseId, metricId)
  },

  transcripts: {
    list: (variantId: number) => ipcRenderer.invoke('transcripts:list', variantId),
    switch: (variantId: number, transcriptId: string) =>
      ipcRenderer.invoke('transcripts:switch', variantId, transcriptId),
    insertAndSwitch: (variantId: number, transcript: Record<string, unknown>) =>
      ipcRenderer.invoke('transcripts:insertAndSwitch', variantId, transcript)
  },

  tags: {
    // Tag CRUD
    list: () => ipcRenderer.invoke('tags:list'),

    create: (name: string, color: string) => ipcRenderer.invoke('tags:create', name, color),

    update: (id: number, updates: { name?: string; color?: string }) =>
      ipcRenderer.invoke('tags:update', id, updates),

    delete: (id: number) => ipcRenderer.invoke('tags:delete', id),

    getUsageCount: (tagId: number) => ipcRenderer.invoke('tags:getUsageCount', tagId),

    // Variant tag assignments
    getVariantTags: (caseId: number, variantId: number) =>
      ipcRenderer.invoke('tags:getVariantTags', caseId, variantId),

    assignVariantTag: (caseId: number, variantId: number, tagId: number) =>
      ipcRenderer.invoke('tags:assignVariantTag', caseId, variantId, tagId),

    removeVariantTag: (caseId: number, variantId: number, tagId: number) =>
      ipcRenderer.invoke('tags:removeVariantTag', caseId, variantId, tagId),

    setVariantTags: (caseId: number, variantId: number, tagIds: number[]) =>
      ipcRenderer.invoke('tags:setVariantTags', caseId, variantId, tagIds)
  },

  logs: {
    /**
     * Register log message listener. Returns cleanup function.
     * IMPORTANT: Call the returned function on component unmount to prevent memory leaks.
     */
    onMessage: (callback: (log: LogMessage) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, log: LogMessage) => {
        callback(log)
      }
      ipcRenderer.on('logs:message', handler)

      // Return cleanup function
      return () => {
        ipcRenderer.removeListener('logs:message', handler)
      }
    }
  },

  audit: {
    getByEntity: (entityKey: string) => ipcRenderer.invoke('audit:getByEntity', entityKey),
    query: (params: Record<string, unknown>) => ipcRenderer.invoke('audit:query', params)
  },

  geneLists: {
    list: () => ipcRenderer.invoke('gene-lists:list'),
    create: (name: string, description?: string | null) =>
      ipcRenderer.invoke('gene-lists:create', name, description),
    delete: (id: number) => ipcRenderer.invoke('gene-lists:delete', id),
    getGenes: (listId: number) => ipcRenderer.invoke('gene-lists:getGenes', listId),
    setGenes: (listId: number, genes: string[]) =>
      ipcRenderer.invoke('gene-lists:setGenes', listId, genes)
  },

  regionFiles: {
    list: () => ipcRenderer.invoke('region-files:list'),
    create: (name: string, description: string | null) =>
      ipcRenderer.invoke('region-files:create', name, description),
    delete: (id: number) => ipcRenderer.invoke('region-files:delete', id),
    importBed: (fileId: number, filePath: string) =>
      ipcRenderer.invoke('region-files:importBed', fileId, filePath)
  },

  panels: {
    list: () => ipcRenderer.invoke('panels:list'),
    get: (id: number) => ipcRenderer.invoke('panels:get', id),
    create: (params: {
      name: string
      description?: string | null
      version?: string | null
      source?: string
      sourceId?: string | null
      sourceMetadata?: Record<string, unknown> | null
    }) => ipcRenderer.invoke('panels:create', params),
    update: (params: {
      id: number
      name?: string
      description?: string | null
      version?: string | null
    }) => ipcRenderer.invoke('panels:update', params),
    delete: (id: number) => ipcRenderer.invoke('panels:delete', id),
    duplicate: (id: number, newName: string) =>
      ipcRenderer.invoke('panels:duplicate', { id, newName }),
    setGenes: (panelId: number, genes: Array<{ hgncId: string; symbol: string }>) =>
      ipcRenderer.invoke('panels:setGenes', { panelId, genes }),
    getGenes: (panelId: number) => ipcRenderer.invoke('panels:getGenes', panelId),
    activate: (caseId: number, panelId: number, paddingBp?: number) =>
      ipcRenderer.invoke('panels:activate', { caseId, panelId, paddingBp }),
    deactivate: (caseId: number, panelId: number) =>
      ipcRenderer.invoke('panels:deactivate', { caseId, panelId }),
    activeForCase: (caseId: number) => ipcRenderer.invoke('panels:active-for-case', caseId),
    validateSymbols: (symbols: string[]) =>
      ipcRenderer.invoke('panels:validate-symbols', { symbols }),
    autocomplete: (query: string, limit?: number) =>
      ipcRenderer.invoke('panels:autocomplete', { query, limit }),
    searchPanelApp: (keyword: string, region: 'uk' | 'aus' | 'both') =>
      ipcRenderer.invoke('panels:search-panelapp', { keyword, region }),
    importPanelApp: (params: {
      panelId: number
      region: 'uk' | 'aus'
      confidenceThreshold: 'green' | 'green_amber' | 'all'
      name?: string
    }) => ipcRenderer.invoke('panels:import-panelapp', params),
    generateStringDb: (params: {
      seedGenes: string[]
      requiredScore: number
      networkType: 'physical' | 'functional'
      name?: string
    }) => ipcRenderer.invoke('panels:generate-stringdb', params),
    exportBed: (panelId: number, assembly: string, paddingBp: number) =>
      ipcRenderer.invoke('panels:export-bed', { panelId, assembly, paddingBp })
  },

  geneRef: {
    info: () => ipcRenderer.invoke('gene-ref:info'),
    assemblies: () => ipcRenderer.invoke('gene-ref:assemblies'),
    checkUpdates: () => ipcRenderer.invoke('gene-ref:check-updates'),
    update: () => ipcRenderer.invoke('gene-ref:update')
  },

  updater: {
    checkForUpdate: () => ipcRenderer.invoke('updater:check'),
    downloadUpdate: () => ipcRenderer.invoke('updater:download'),
    installUpdate: () => ipcRenderer.invoke('updater:install'),
    getStatus: () => ipcRenderer.invoke('updater:status'),
    onStatusChange: (
      callback: (status: import('../shared/types/api').UpdateStatus) => void
    ): (() => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        status: import('../shared/types/api').UpdateStatus
      ): void => {
        callback(status)
      }
      ipcRenderer.on('updater:status', handler)
      return () => {
        ipcRenderer.removeListener('updater:status', handler)
      }
    }
  },

  auth: {
    login: (username: string, password: string) =>
      ipcRenderer.invoke('auth:login', username, password),
    logout: () => ipcRenderer.invoke('auth:logout'),
    currentUser: () => ipcRenderer.invoke('auth:currentUser'),
    isAccountsEnabled: () => ipcRenderer.invoke('auth:isAccountsEnabled'),
    createUser: (username: string, displayName: string, tempPassword: string) =>
      ipcRenderer.invoke('auth:createUser', username, displayName, tempPassword),
    listUsers: () => ipcRenderer.invoke('auth:listUsers'),
    deactivateUser: (username: string) => ipcRenderer.invoke('auth:deactivateUser', username),
    resetPassword: (username: string, newPassword: string) =>
      ipcRenderer.invoke('auth:resetPassword', username, newPassword),
    changePassword: (oldPassword: string, newPassword: string) =>
      ipcRenderer.invoke('auth:changePassword', oldPassword, newPassword)
  },

  analysisGroups: {
    list: () => ipcRenderer.invoke('analysisGroups:list'),
    get: (id: number) => ipcRenderer.invoke('analysisGroups:get', id),
    create: (params: { name: string; groupType?: string; description?: string }) =>
      ipcRenderer.invoke('analysisGroups:create', params),
    update: (id: number, params: { name?: string; description?: string }) =>
      ipcRenderer.invoke('analysisGroups:update', id, params),
    delete: (id: number) => ipcRenderer.invoke('analysisGroups:delete', id),
    addMember: (params: {
      groupId: number
      caseId: number
      role: string
      affectedStatus?: string
      individualId?: string
    }) => ipcRenderer.invoke('analysisGroups:addMember', params),
    removeMember: (groupId: number, caseId: number) =>
      ipcRenderer.invoke('analysisGroups:removeMember', groupId, caseId),
    getForCase: (caseId: number) => ipcRenderer.invoke('analysisGroups:getForCase', caseId)
  },

  protein: {
    getMapping: (geneSymbol: string) => ipcRenderer.invoke('protein:mapping', geneSymbol),
    getDomains: (uniprotAccession: string) =>
      ipcRenderer.invoke('protein:domains', uniprotAccession),
    getStructure: (uniprotAccession: string) =>
      ipcRenderer.invoke('protein:structure', uniprotAccession),
    getGeneStructure: (geneSymbol: string) =>
      ipcRenderer.invoke('protein:gene-structure', geneSymbol)
  },

  gnomad: {
    getVariants: (geneSymbol: string, dataset?: string) =>
      ipcRenderer.invoke('gnomad:variants', geneSymbol, dataset),
    getClinVarVariants: (geneSymbol: string, dataset?: string) =>
      ipcRenderer.invoke('gnomad:clinvar', geneSymbol, dataset)
  },

  perf: {
    reportInteractive: () => ipcRenderer.send('perf:interactive')
  },

  presets: {
    list: () => ipcRenderer.invoke('presets:list'),

    create: (params: {
      name: string
      description?: string | null
      filterJson: Record<string, unknown>
      isVisible?: boolean
      sortOrder?: number
    }) => ipcRenderer.invoke('presets:create', params),

    update: (
      id: number,
      updates: {
        name?: string
        description?: string | null
        filterJson?: Record<string, unknown>
        isVisible?: boolean
        sortOrder?: number
      }
    ) => ipcRenderer.invoke('presets:update', id, updates),

    delete: (id: number) => ipcRenderer.invoke('presets:delete', id),

    reorder: (items: { id: number; sortOrder: number }[]) =>
      ipcRenderer.invoke('presets:reorder', items)
  }
}

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
