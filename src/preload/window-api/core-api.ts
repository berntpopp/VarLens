import { ipcRenderer } from 'electron'
import type { PreloadDomainApis } from './domains'
import { requestRendererPerfSnapshot, subscribeToIpcEvent } from './events'
import type { MainPerfSnapshot } from '../../shared/types/perf'
import type { WindowAPI } from '../../shared/types/api'

type CoreWindowApi = Pick<
  WindowAPI,
  | 'cases'
  | 'variants'
  | 'import'
  | 'system'
  | 'export'
  | 'shell'
  | 'database'
  | 'batchImport'
  | 'cohort'
  | 'annotations'
  | 'vep'
  | 'hpo'
  | 'myvariant'
  | 'spliceai'
  | 'logs'
  | 'updater'
  | 'perf'
>

export function createCoreApi(domains: PreloadDomainApis): CoreWindowApi {
  const {
    annotationsDomain,
    batchImportDomain,
    casesDomain,
    cohortDomain,
    databaseDomain,
    exportDomain,
    hpoDomain,
    importDomain,
    myvariantDomain,
    spliceaiDomain,
    variantsDomain,
    vepDomain
  } = domains

  return {
    cases: {
      list: () => casesDomain.list(),
      query: (params) => casesDomain.query(params),
      delete: (id) => casesDomain.delete(id),
      deleteAll: () => casesDomain.deleteAll(),
      deleteBatch: (ids) => casesDomain.deleteBatch(ids),
      availableBuilds: () => casesDomain.availableBuilds()
    },

    variants: {
      query: (caseId, filters, offset, limit, sortBy, skipCount, includeUnfilteredCount) =>
        variantsDomain.query(
          caseId,
          filters,
          offset,
          limit,
          sortBy,
          skipCount,
          includeUnfilteredCount
        ),
      getFilterOptions: (caseId) => variantsDomain.getFilterOptions(caseId),
      search: (caseId, query, limit) => variantsDomain.search(caseId, query, limit ?? 20),
      geneSymbols: (caseId, query, limit) => variantsDomain.geneSymbols(caseId, query, limit ?? 50),
      typeCounts: (caseId) => variantsDomain.typeCounts(caseId),
      columnMeta: (payload) => variantsDomain.columnMeta(payload),
      typesPresent: (payload) => variantsDomain.typesPresent(payload),
      shortlist: (params) => ipcRenderer.invoke('variants:shortlist', params),
      onAnnotationChanged: (callback) => subscribeToIpcEvent('variants:annotationChanged', callback)
    },

    import: {
      selectFile: () => importDomain.selectFile(),
      selectFiles: () => importDomain.selectFiles(),
      selectBedFile: () => importDomain.selectBedFile(),
      start: (filePath, caseName, vcfOptions) => importDomain.start(filePath, caseName, vcfOptions),
      startMultiFile: (caseName, files, vcfOptions, filters) =>
        importDomain.startMultiFile(caseName, files, vcfOptions, filters),
      vcfPreview: (filePath) => importDomain.vcfPreview(filePath),
      vcfMultiPreview: (filePaths) => importDomain.vcfMultiPreview(filePaths),
      onProgress: (callback) => subscribeToIpcEvent('import:progress', callback),
      cancel: () => importDomain.cancel()
    } as WindowAPI['import'],

    system: {
      getVersion: () => ipcRenderer.invoke('system:version'),
      getUserDataPath: () => ipcRenderer.invoke('system:userDataPath'),
      getCpuCount: () => ipcRenderer.invoke('system:getCpuCount'),
      setWorkerThreads: (count) => ipcRenderer.invoke('system:setWorkerThreads', count),
      getWorkerThreads: () => ipcRenderer.invoke('system:getWorkerThreads'),
      getLogFilePath: () => ipcRenderer.invoke('system:logFilePath')
    },

    export: {
      variants: (caseId, filters, caseName) => exportDomain.variants(caseId, filters, caseName),
      cohort: (params) => exportDomain.cohort(params)
    },

    shell: {
      openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
      updateDomains: (domains) => ipcRenderer.invoke('shell:updateUserDomains', domains),
      showItemInFolder: (filePath) => ipcRenderer.invoke('shell:showItemInFolder', filePath)
    },

    database: {
      selectFile: () => databaseDomain.selectFile(),
      selectSaveLocation: (defaultName) => databaseDomain.selectSaveLocation(defaultName),
      open: (path, password) => databaseDomain.open(path, password),
      create: (path, password) => databaseDomain.create(path, password),
      rekey: (newPassword) => databaseDomain.rekey(newPassword),
      info: () => databaseDomain.info(),
      capabilities: () => databaseDomain.capabilities(),
      postgresDiagnostics: () => databaseDomain.postgresDiagnostics(),
      postgresProfilesList: () => databaseDomain.postgresProfilesList(),
      postgresProfileSave: (input) => databaseDomain.postgresProfileSave(input),
      postgresProfileRemove: (profileId) => databaseDomain.postgresProfileRemove(profileId),
      postgresProfileTest: (input) => databaseDomain.postgresProfileTest(input),
      postgresProfileOpen: (profileId) => databaseDomain.postgresProfileOpen(profileId),
      recentList: () => databaseDomain.recentList(),
      getOverview: () => databaseDomain.getOverview(),
      removeRecent: (path) => databaseDomain.removeRecent(path),
      deleteFile: (path) => databaseDomain.deleteFile(path),
      showInFolder: (path) => databaseDomain.showInFolder(path)
    } as WindowAPI['database'],

    batchImport: {
      selectFiles: () => batchImportDomain.selectFiles(),
      selectFolder: () => batchImportDomain.selectFolder(),
      checkDuplicates: (filePaths, stripText) =>
        batchImportDomain.checkDuplicates(filePaths, stripText),
      start: (filePaths, duplicateStrategy, stripText) =>
        batchImportDomain.start(filePaths, duplicateStrategy, stripText),
      cancel: () => batchImportDomain.cancel(),
      selectZip: () => batchImportDomain.selectZip(),
      testZipPassword: (zipPath, password) => batchImportDomain.testZipPassword(zipPath, password),
      extractZip: (zipPath, password) => batchImportDomain.extractZip(zipPath, password),
      cleanupZipTemp: () => batchImportDomain.cleanupZipTemp(),
      onProgress: (callback) => subscribeToIpcEvent('batch-import:progress', callback),
      onComplete: (callback) => subscribeToIpcEvent('batch-import:complete', callback)
    } as WindowAPI['batchImport'],

    cohort: {
      getVariants: (params) => cohortDomain.getVariants(params),
      getColumnMeta: () => cohortDomain.getColumnMeta(),
      getSummary: () => cohortDomain.getSummary(),
      getCarriers: (chr, pos, ref, alt) => cohortDomain.getCarriers(chr, pos, ref, alt),
      getGeneBurden: () => cohortDomain.getGeneBurden(),
      runAssociation: (config) => cohortDomain.runAssociation(config),
      cancelAssociation: () => cohortDomain.cancelAssociation(),
      onAssociationProgress: (callback) =>
        subscribeToIpcEvent('cohort:geneBurdenProgress', callback),
      getSummaryStatus: () => cohortDomain.getSummaryStatus(),
      rebuildSummary: () => cohortDomain.rebuildSummary(),
      onSummaryRebuilt: (callback) => subscribeToIpcEvent('cohort:summaryRebuilt', callback)
    } as WindowAPI['cohort'],

    annotations: {
      getGlobal: (chr, pos, ref, alt) => annotationsDomain.getGlobal(chr, pos, ref, alt),
      upsertGlobal: (chr, pos, ref, alt, updates) =>
        annotationsDomain.upsertGlobal(chr, pos, ref, alt, updates),
      deleteGlobal: (chr, pos, ref, alt) => annotationsDomain.deleteGlobal(chr, pos, ref, alt),
      getPerCase: (caseId, variantId) => annotationsDomain.getPerCase(caseId, variantId),
      upsertPerCase: (caseId, variantId, updates) =>
        annotationsDomain.upsertPerCase(caseId, variantId, updates),
      deletePerCase: (caseId, variantId) => annotationsDomain.deletePerCase(caseId, variantId),
      getForVariant: (caseId, chr, pos, ref, alt) =>
        annotationsDomain.getForVariant(caseId, chr, pos, ref, alt),
      batchGet: (caseId, variantKeys) => annotationsDomain.batchGet(caseId, variantKeys)
    },

    vep: {
      fetch: (chr, pos, ref, alt) => vepDomain.fetch(chr, pos, ref, alt),
      cancel: () => vepDomain.cancel(),
      clearCache: () => vepDomain.clearCache(),
      getCacheStats: () => vepDomain.getCacheStats()
    },

    hpo: {
      search: (query, maxResults) => hpoDomain.search(query, maxResults),
      clearCache: () => hpoDomain.clearCache()
    },

    myvariant: {
      fetch: (chr, pos, ref, alt) => myvariantDomain.fetch(chr, pos, ref, alt),
      clearCache: () => myvariantDomain.clearCache()
    },

    spliceai: {
      fetch: (chr, pos, ref, alt) => spliceaiDomain.fetch(chr, pos, ref, alt),
      clearCache: () => spliceaiDomain.clearCache()
    },

    logs: {
      onMessage: (callback) => subscribeToIpcEvent('logs:message', callback)
    },

    updater: {
      checkForUpdate: () => ipcRenderer.invoke('updater:check'),
      downloadUpdate: () => ipcRenderer.invoke('updater:download'),
      installUpdate: () => ipcRenderer.invoke('updater:install'),
      getStatus: () => ipcRenderer.invoke('updater:status'),
      onStatusChange: (callback) => subscribeToIpcEvent('updater:status', callback)
    },

    perf: {
      reportInteractive: () => ipcRenderer.send('perf:interactive'),
      getSnapshot: async () => {
        const [mainSnapshot, rendererSnapshot] = await Promise.all([
          ipcRenderer.invoke('perf:mainSnapshot') as Promise<MainPerfSnapshot>,
          requestRendererPerfSnapshot('get')
        ])

        return {
          capturedAt: new Date().toISOString(),
          main: mainSnapshot,
          renderer: rendererSnapshot
        }
      },
      resetSnapshot: async () => {
        await requestRendererPerfSnapshot('reset')
      },
      isEnabled: () => process.env.VARLENS_PERF_MODE === '1'
    } as WindowAPI['perf']
  }
}
