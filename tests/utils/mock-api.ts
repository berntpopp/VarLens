/**
 * Mock API factory for renderer tests.
 *
 * Provides createMockApi() that returns a type-safe mock matching the WindowAPI structure.
 * All methods return vi.fn() mocks with sensible default values.
 */

import { vi, type Mock } from 'vitest'
import type { WindowAPI } from '../../src/shared/types/api'
import type { StorageCapabilities } from '../../src/shared/types/storage-capabilities'

type MockApiDomain<T extends Record<string, unknown>> = {
  [K in keyof T]: T[K] extends (...args: infer Args) => infer Result
    ? Mock<(...args: Args) => Result>
    : never
}

/**
 * Mock API type matching WindowAPI from preload.
 * All methods are vi.fn() mocks for spy verification.
 */
export type MockApi = {
  cases: MockApiDomain<WindowAPI['cases']>
  variants: MockApiDomain<WindowAPI['variants']>
  import: MockApiDomain<WindowAPI['import']>
  system: MockApiDomain<WindowAPI['system']>
  export: MockApiDomain<WindowAPI['export']>
  shell: MockApiDomain<WindowAPI['shell']>
  database: MockApiDomain<WindowAPI['database']>
  batchImport: MockApiDomain<WindowAPI['batchImport']>
  cohort: MockApiDomain<WindowAPI['cohort']>
  annotations: MockApiDomain<WindowAPI['annotations']>
  vep: MockApiDomain<WindowAPI['vep']>
  hpo: MockApiDomain<WindowAPI['hpo']>
  myvariant: MockApiDomain<WindowAPI['myvariant']>
  spliceai: MockApiDomain<WindowAPI['spliceai']>
  caseMetadata: MockApiDomain<WindowAPI['caseMetadata']>
  tags: MockApiDomain<WindowAPI['tags']>
  presets: MockApiDomain<WindowAPI['presets']>
  panels: MockApiDomain<WindowAPI['panels']>
  geneRef: MockApiDomain<WindowAPI['geneRef']>
  protein: MockApiDomain<WindowAPI['protein']>
  gnomad: MockApiDomain<WindowAPI['gnomad']>
  logs: MockApiDomain<WindowAPI['logs']>
  caseComments: MockApiDomain<WindowAPI['caseComments']>
  caseMetrics: MockApiDomain<WindowAPI['caseMetrics']>
  transcripts: MockApiDomain<WindowAPI['transcripts']>
  geneLists: MockApiDomain<WindowAPI['geneLists']>
  regionFiles: MockApiDomain<WindowAPI['regionFiles']>
  updater: MockApiDomain<WindowAPI['updater']>
  audit: MockApiDomain<WindowAPI['audit']>
  auth: MockApiDomain<WindowAPI['auth']>
  analysisGroups: MockApiDomain<WindowAPI['analysisGroups']>
  perf: MockApiDomain<WindowAPI['perf']>
  debug: MockApiDomain<WindowAPI['debug']>
  jobs: MockApiDomain<WindowAPI['jobs']>
}

const TEST_SQLITE_CAPABILITIES: StorageCapabilities = {
  backend: 'sqlite',
  workspace: {
    localFileLifecycle: true,
    hostedConnectionLifecycle: false,
    encryptionAtRest: true,
    migrations: true,
    healthDiagnostics: true
  },
  cases: {
    list: true,
    query: true,
    deleteOne: true,
    deleteMany: true,
    deleteAll: true,
    overview: true
  },
  imports: {
    json: true,
    vcf: true,
    multiFileVcf: true,
    bedFilters: true,
    cancellation: true
  },
  variants: {
    query: true,
    searchQuery: true,
    legacySearch: true,
    filterOptions: true,
    columnMeta: true,
    typeCounts: true,
    typesPresent: true,
    geneSymbols: true,
    panelFilters: true,
    tagFilters: true,
    commentFilters: true,
    acmgFilters: true,
    annotationFilters: true,
    inheritanceFilters: true,
    analysisGroupFilters: true,
    phasingFilters: true
  },
  workflow: {
    tags: true,
    annotations: true,
    caseComments: true,
    caseMetrics: true,
    filterPresets: true,
    panels: true,
    geneLists: true,
    regionFiles: true,
    analysisGroups: true,
    auditLog: true
  },
  cohort: {
    query: true,
    summary: true,
    rebuild: true,
    carriers: true,
    geneBurden: true,
    columnMeta: true
  },
  export: {
    variants: true,
    cohort: true,
    streaming: true
  }
}

/**
 * Creates a fresh mock API matching WindowAPI structure.
 * All methods return vi.fn() with sensible default values.
 *
 * Usage:
 * ```typescript
 * const mockApi = createMockApi()
 * mockApi.cases.list.mockResolvedValue([])
 * window.api = mockApi
 * ```
 */
export function createMockApi(): MockApi {
  const api: MockApi = {
    cases: {
      list: vi.fn().mockResolvedValue([]),
      delete: vi.fn().mockResolvedValue(undefined),
      deleteAll: vi.fn().mockResolvedValue(0),
      deleteBatch: vi.fn().mockResolvedValue(0)
    },

    variants: {
      query: vi.fn().mockResolvedValue({ data: [], total_count: 0 }),
      getFilterOptions: vi.fn().mockResolvedValue({}),
      search: vi.fn().mockResolvedValue([]),
      geneSymbols: vi.fn().mockResolvedValue([])
    },

    import: {
      selectFile: vi.fn().mockResolvedValue(null),
      selectFiles: vi.fn().mockResolvedValue([]),
      selectBedFile: vi.fn().mockResolvedValue(null),
      enrollDroppedFiles: vi.fn().mockResolvedValue([]),
      start: vi.fn().mockResolvedValue({ success: true }),
      startMultiFile: vi.fn().mockResolvedValue({
        caseId: 1,
        totalVariants: 0,
        totalSkipped: 0,
        files: [],
        elapsed: 0
      }),
      vcfPreview: vi.fn().mockResolvedValue({
        fileformat: 'VCFv4.2',
        samples: [],
        variantCountEstimate: 0,
        annotationType: 'none',
        detectedGenomeBuild: null,
        infoFields: [],
        callerName: null,
        callerVersion: null,
        defaultVariantType: 'snv',
        filePath: '/tmp/mock.vcf',
        fileSize: 0
      }),
      vcfMultiPreview: vi.fn().mockResolvedValue({
        files: [],
        siblingBedFiles: [],
        suggestedCaseName: 'Mock case'
      }),
      onProgress: vi.fn(() => vi.fn()), // Returns cleanup function
      cancel: vi.fn().mockResolvedValue(undefined)
    },

    system: {
      getVersion: vi.fn().mockResolvedValue('0.0.0-test'),
      getUserDataPath: vi.fn().mockResolvedValue('/tmp/test')
    },

    export: {
      variants: vi.fn().mockResolvedValue({ success: true }),
      cohort: vi.fn().mockResolvedValue({ success: true }),
      revealInFolder: vi.fn().mockResolvedValue({ success: false })
    },

    shell: {
      openExternal: vi.fn().mockResolvedValue(undefined),
      updateDomains: vi.fn().mockResolvedValue(undefined)
    },

    database: {
      selectFile: vi.fn().mockResolvedValue(null),
      selectSaveLocation: vi.fn().mockResolvedValue(null),
      open: vi.fn().mockResolvedValue({ success: true }),
      create: vi.fn().mockResolvedValue({ success: true }),
      rekey: vi.fn().mockResolvedValue({ success: true }),
      migrateToEncrypted: vi.fn().mockResolvedValue({ success: true }),
      deletePlaintextBackup: vi.fn().mockResolvedValue({ success: true }),
      setRecoveryPassphrase: vi
        .fn()
        .mockResolvedValue({ success: true, recoveryPassphraseSet: true, sidecarWritten: true }),
      info: vi.fn().mockResolvedValue({ path: '/tmp/test.db', encrypted: false }),
      capabilities: vi.fn().mockResolvedValue(TEST_SQLITE_CAPABILITIES),
      postgresDiagnostics: vi.fn().mockResolvedValue({ ok: false, schema: '' }),
      postgresProfilesList: vi.fn().mockResolvedValue([]),
      postgresProfileSave: vi.fn().mockImplementation((input) => {
        const { secrets, ...profile } = input
        return Promise.resolve({
          id: 'mock-postgres-profile',
          ...profile,
          caCertificateConfigured: Boolean(secrets?.caCertificatePem)
        })
      }),
      postgresProfileRemove: vi.fn().mockResolvedValue({ success: true }),
      postgresProfileTest: vi.fn().mockResolvedValue({ ok: false, schema: '' }),
      postgresProfileOpen: vi.fn().mockResolvedValue({ success: true }),
      recentList: vi.fn().mockResolvedValue([])
    },

    batchImport: {
      selectFiles: vi.fn().mockResolvedValue([]),
      selectFolder: vi.fn().mockResolvedValue(null),
      checkDuplicates: vi.fn().mockResolvedValue({ duplicates: [], unique: [] }),
      start: vi.fn().mockResolvedValue({ success: true }),
      cancel: vi.fn().mockResolvedValue(undefined),
      selectZip: vi.fn().mockResolvedValue(null),
      testZipPassword: vi.fn().mockResolvedValue({ valid: true }),
      extractZip: vi.fn().mockResolvedValue({
        files: [],
        errors: [],
        extractionId: 'mock-extraction-id'
      }),
      cleanupZipTemp: vi.fn().mockResolvedValue(undefined),
      onProgress: vi.fn(() => vi.fn()), // Returns cleanup function
      onComplete: vi.fn(() => vi.fn()) // Returns cleanup function
    },

    cohort: {
      getVariants: vi.fn().mockResolvedValue({ data: [], total_count: 0 }),
      getSummary: vi.fn().mockResolvedValue({ totalCases: 0, totalVariants: 0 }),
      getCarriers: vi.fn().mockResolvedValue([]),
      getGeneBurden: vi.fn().mockResolvedValue([]),
      runAssociation: vi.fn().mockResolvedValue({ results: [], warnings: [] }),
      cancelAssociation: vi.fn().mockResolvedValue(undefined),
      onAssociationProgress: vi.fn(() => vi.fn()) // Returns cleanup function
    },

    annotations: {
      getGlobal: vi.fn().mockResolvedValue(null),
      upsertGlobal: vi.fn().mockResolvedValue(undefined),
      deleteGlobal: vi.fn().mockResolvedValue(undefined),
      getPerCase: vi.fn().mockResolvedValue(null),
      upsertPerCase: vi.fn().mockResolvedValue(undefined),
      deletePerCase: vi.fn().mockResolvedValue(undefined),
      getForVariant: vi.fn().mockResolvedValue({ global: null, perCase: null }),
      batchGet: vi.fn().mockResolvedValue({})
    },

    vep: {
      fetch: vi.fn().mockResolvedValue(null),
      cancel: vi.fn().mockResolvedValue(undefined),
      clearCache: vi.fn().mockResolvedValue(undefined),
      getCacheStats: vi.fn().mockResolvedValue({ count: 0, size: 0 })
    },

    hpo: {
      search: vi.fn().mockResolvedValue([]),
      clearCache: vi.fn().mockResolvedValue(undefined)
    },

    myvariant: {
      fetch: vi.fn().mockResolvedValue(null),
      clearCache: vi.fn().mockResolvedValue(undefined)
    },

    spliceai: {
      fetch: vi.fn().mockResolvedValue(null),
      clearCache: vi.fn().mockResolvedValue(undefined)
    },

    caseMetadata: {
      get: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue(undefined),
      getFullMetadata: vi.fn().mockResolvedValue(null),
      listCohorts: vi.fn().mockResolvedValue([]),
      createCohort: vi.fn().mockResolvedValue({ id: 1 }),
      deleteCohort: vi.fn().mockResolvedValue(undefined),
      getCohortByName: vi.fn().mockResolvedValue(null),
      getCaseCohorts: vi.fn().mockResolvedValue([]),
      assignCohort: vi.fn().mockResolvedValue(undefined),
      removeCohort: vi.fn().mockResolvedValue(undefined),
      setCohorts: vi.fn().mockResolvedValue(undefined),
      getHpoTerms: vi.fn().mockResolvedValue([]),
      assignHpoTerm: vi.fn().mockResolvedValue(undefined),
      removeHpoTerm: vi.fn().mockResolvedValue(undefined)
    },

    tags: {
      list: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: 1 }),
      update: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      getUsageCount: vi.fn().mockResolvedValue(0),
      getVariantTags: vi.fn().mockResolvedValue([]),
      assignVariantTag: vi.fn().mockResolvedValue(undefined),
      removeVariantTag: vi.fn().mockResolvedValue(undefined),
      setVariantTags: vi.fn().mockResolvedValue(undefined)
    },

    presets: {
      list: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue(undefined),
      reorder: vi.fn().mockResolvedValue(undefined)
    },

    panels: {
      list: vi.fn().mockResolvedValue([]),
      get: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 1 }),
      update: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue({ success: true }),
      duplicate: vi.fn().mockResolvedValue({ id: 2 }),
      setGenes: vi.fn().mockResolvedValue(undefined),
      getGenes: vi.fn().mockResolvedValue([]),
      activate: vi.fn().mockResolvedValue(undefined),
      deactivate: vi.fn().mockResolvedValue(undefined),
      activeForCase: vi.fn().mockResolvedValue([]),
      validateSymbols: vi.fn().mockResolvedValue([]),
      autocomplete: vi.fn().mockResolvedValue([]),
      exportBed: vi.fn().mockResolvedValue({ success: true })
    },

    geneRef: {
      info: vi.fn().mockResolvedValue({
        geneCount: 44983,
        aliasCount: 100000,
        coordinateCount: 80000,
        assemblies: ['GRCh37', 'GRCh38'],
        builtAt: Math.floor(Date.now() / 1000)
      }),
      assemblies: vi.fn().mockResolvedValue([]),
      checkUpdates: vi
        .fn()
        .mockResolvedValue({ currentBuiltAt: 0, daysSinceBuilt: 0, needsUpdate: false }),
      update: vi.fn().mockResolvedValue({ success: true, message: 'Updated' })
    },

    protein: {
      getMapping: vi.fn().mockResolvedValue({ success: false, error: 'Not mocked' }),
      getDomains: vi.fn().mockResolvedValue({ success: false, error: 'Not mocked' }),
      getStructure: vi.fn().mockResolvedValue({ success: false, error: 'Not mocked' }),
      getGeneStructure: vi.fn().mockResolvedValue({ success: false, error: 'Not mocked' })
    },

    gnomad: {
      getVariants: vi.fn().mockResolvedValue({ success: false, error: 'Not mocked' }),
      getClinVarVariants: vi.fn().mockResolvedValue({ success: false, error: 'Not mocked' })
    },

    logs: {
      onMessage: vi.fn(() => vi.fn()) // Returns cleanup function
    },

    caseComments: {
      list: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: 1 }),
      update: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined)
    },

    caseMetrics: {
      listDefinitions: vi.fn().mockResolvedValue([]),
      createDefinition: vi.fn().mockResolvedValue({ id: 1 }),
      listForCase: vi.fn().mockResolvedValue([]),
      upsert: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined)
    },

    transcripts: {
      list: vi.fn().mockResolvedValue([]),
      switch: vi.fn().mockResolvedValue(undefined),
      insertAndSwitch: vi.fn().mockResolvedValue(undefined)
    },

    geneLists: {
      list: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: 1 }),
      delete: vi.fn().mockResolvedValue(undefined),
      getGenes: vi.fn().mockResolvedValue([]),
      setGenes: vi.fn().mockResolvedValue(undefined)
    },

    regionFiles: {
      list: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: 1 }),
      delete: vi.fn().mockResolvedValue(undefined),
      importBed: vi.fn().mockResolvedValue({ success: true })
    },

    updater: {
      checkForUpdate: vi.fn().mockResolvedValue(undefined),
      downloadUpdate: vi.fn().mockResolvedValue(undefined),
      installUpdate: vi.fn().mockResolvedValue(undefined),
      getStatus: vi.fn().mockResolvedValue({ state: 'idle' }),
      onStatusChange: vi.fn(() => vi.fn()) // Returns cleanup function
    },

    audit: {
      getByEntity: vi.fn().mockResolvedValue([]),
      query: vi.fn().mockResolvedValue([])
    },

    auth: {
      login: vi.fn().mockResolvedValue({ success: true }),
      logout: vi.fn().mockResolvedValue(undefined),
      currentUser: vi.fn().mockResolvedValue(null),
      isAccountsEnabled: vi.fn().mockResolvedValue(false),
      createUser: vi.fn().mockResolvedValue(undefined),
      listUsers: vi.fn().mockResolvedValue([]),
      deactivateUser: vi.fn().mockResolvedValue(undefined),
      resetPassword: vi.fn().mockResolvedValue(undefined),
      changePassword: vi.fn().mockResolvedValue(undefined)
    },

    analysisGroups: {
      list: vi.fn().mockResolvedValue([]),
      get: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 1 }),
      update: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      addMember: vi.fn().mockResolvedValue(undefined),
      removeMember: vi.fn().mockResolvedValue(undefined),
      getForCase: vi.fn().mockResolvedValue([])
    },

    perf: {
      reportInteractive: vi.fn(),
      getSnapshot: vi.fn().mockResolvedValue({
        capturedAt: new Date().toISOString(),
        main: { elapsedMs: 0, milestones: {} },
        renderer: {
          traces: [],
          longTasks: { count: 0, totalDurationMs: 0, maxDurationMs: 0 }
        }
      }),
      resetSnapshot: vi.fn().mockResolvedValue(undefined),
      isEnabled: vi.fn().mockReturnValue(false)
    },

    debug: {
      queryCountersGet: vi.fn().mockResolvedValue({ named: {}, unnamed: 0, enabled: false }),
      queryCountersReset: vi.fn().mockResolvedValue({ enabled: false })
    },

    jobs: {
      list: vi.fn().mockResolvedValue({ data: [] }),
      get: vi.fn().mockResolvedValue({ data: null }),
      progress: vi.fn().mockResolvedValue({ data: null })
    }
  }

  const windowApi: WindowAPI = api
  void windowApi

  return api
}
