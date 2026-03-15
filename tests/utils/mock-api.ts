/**
 * Mock API factory for renderer tests.
 *
 * Provides createMockApi() that returns a type-safe mock matching the WindowAPI structure.
 * All methods return vi.fn() mocks with sensible default values.
 */

import { vi } from 'vitest'

/**
 * Mock API type matching WindowAPI from preload.
 * All methods are vi.fn() mocks for spy verification.
 */
export type MockApi = {
  cases: {
    list: ReturnType<typeof vi.fn>
    delete: ReturnType<typeof vi.fn>
    deleteAll: ReturnType<typeof vi.fn>
    deleteBatch: ReturnType<typeof vi.fn>
  }
  variants: {
    query: ReturnType<typeof vi.fn>
    getFilterOptions: ReturnType<typeof vi.fn>
    search: ReturnType<typeof vi.fn>
  }
  import: {
    selectFile: ReturnType<typeof vi.fn>
    start: ReturnType<typeof vi.fn>
    onProgress: ReturnType<typeof vi.fn>
    cancel: ReturnType<typeof vi.fn>
  }
  system: {
    getVersion: ReturnType<typeof vi.fn>
    getUserDataPath: ReturnType<typeof vi.fn>
  }
  export: {
    variants: ReturnType<typeof vi.fn>
    cohort: ReturnType<typeof vi.fn>
  }
  shell: {
    openExternal: ReturnType<typeof vi.fn>
    updateDomains: ReturnType<typeof vi.fn>
    showItemInFolder: ReturnType<typeof vi.fn>
  }
  database: {
    selectFile: ReturnType<typeof vi.fn>
    selectSaveLocation: ReturnType<typeof vi.fn>
    open: ReturnType<typeof vi.fn>
    create: ReturnType<typeof vi.fn>
    rekey: ReturnType<typeof vi.fn>
    info: ReturnType<typeof vi.fn>
    recentList: ReturnType<typeof vi.fn>
  }
  batchImport: {
    selectFiles: ReturnType<typeof vi.fn>
    selectFolder: ReturnType<typeof vi.fn>
    checkDuplicates: ReturnType<typeof vi.fn>
    start: ReturnType<typeof vi.fn>
    cancel: ReturnType<typeof vi.fn>
    selectZip: ReturnType<typeof vi.fn>
    testZipPassword: ReturnType<typeof vi.fn>
    extractZip: ReturnType<typeof vi.fn>
    cleanupZipTemp: ReturnType<typeof vi.fn>
    onProgress: ReturnType<typeof vi.fn>
  }
  cohort: {
    getVariants: ReturnType<typeof vi.fn>
    getSummary: ReturnType<typeof vi.fn>
    getCarriers: ReturnType<typeof vi.fn>
    getGeneBurden: ReturnType<typeof vi.fn>
  }
  annotations: {
    getGlobal: ReturnType<typeof vi.fn>
    upsertGlobal: ReturnType<typeof vi.fn>
    deleteGlobal: ReturnType<typeof vi.fn>
    getPerCase: ReturnType<typeof vi.fn>
    upsertPerCase: ReturnType<typeof vi.fn>
    deletePerCase: ReturnType<typeof vi.fn>
    getForVariant: ReturnType<typeof vi.fn>
  }
  vep: {
    fetch: ReturnType<typeof vi.fn>
    cancel: ReturnType<typeof vi.fn>
    clearCache: ReturnType<typeof vi.fn>
    getCacheStats: ReturnType<typeof vi.fn>
  }
  hpo: {
    search: ReturnType<typeof vi.fn>
    clearCache: ReturnType<typeof vi.fn>
  }
  myvariant: {
    fetch: ReturnType<typeof vi.fn>
    clearCache: ReturnType<typeof vi.fn>
  }
  spliceai: {
    fetch: ReturnType<typeof vi.fn>
    clearCache: ReturnType<typeof vi.fn>
  }
  caseMetadata: {
    get: ReturnType<typeof vi.fn>
    upsert: ReturnType<typeof vi.fn>
    getFullMetadata: ReturnType<typeof vi.fn>
    listCohorts: ReturnType<typeof vi.fn>
    createCohort: ReturnType<typeof vi.fn>
    deleteCohort: ReturnType<typeof vi.fn>
    getCohortByName: ReturnType<typeof vi.fn>
    getCaseCohorts: ReturnType<typeof vi.fn>
    assignCohort: ReturnType<typeof vi.fn>
    removeCohort: ReturnType<typeof vi.fn>
    setCohorts: ReturnType<typeof vi.fn>
    getHpoTerms: ReturnType<typeof vi.fn>
    assignHpoTerm: ReturnType<typeof vi.fn>
    removeHpoTerm: ReturnType<typeof vi.fn>
  }
  tags: {
    list: ReturnType<typeof vi.fn>
    create: ReturnType<typeof vi.fn>
    update: ReturnType<typeof vi.fn>
    delete: ReturnType<typeof vi.fn>
    getUsageCount: ReturnType<typeof vi.fn>
    getVariantTags: ReturnType<typeof vi.fn>
    assignVariantTag: ReturnType<typeof vi.fn>
    removeVariantTag: ReturnType<typeof vi.fn>
    setVariantTags: ReturnType<typeof vi.fn>
  }
  presets: {
    list: ReturnType<typeof vi.fn>
    create: ReturnType<typeof vi.fn>
    update: ReturnType<typeof vi.fn>
    delete: ReturnType<typeof vi.fn>
    reorder: ReturnType<typeof vi.fn>
  }
  logs: {
    onMessage: ReturnType<typeof vi.fn>
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
  return {
    cases: {
      list: vi.fn().mockResolvedValue([]),
      delete: vi.fn().mockResolvedValue(undefined),
      deleteAll: vi.fn().mockResolvedValue(0),
      deleteBatch: vi.fn().mockResolvedValue(0)
    },

    variants: {
      query: vi.fn().mockResolvedValue({ data: [], total_count: 0 }),
      getFilterOptions: vi.fn().mockResolvedValue({}),
      search: vi.fn().mockResolvedValue([])
    },

    import: {
      selectFile: vi.fn().mockResolvedValue(null),
      start: vi.fn().mockResolvedValue({ success: true }),
      onProgress: vi.fn(() => vi.fn()), // Returns cleanup function
      cancel: vi.fn().mockResolvedValue(undefined)
    },

    system: {
      getVersion: vi.fn().mockResolvedValue('0.0.0-test'),
      getUserDataPath: vi.fn().mockResolvedValue('/tmp/test')
    },

    export: {
      variants: vi.fn().mockResolvedValue({ success: true }),
      cohort: vi.fn().mockResolvedValue({ success: true })
    },

    shell: {
      openExternal: vi.fn().mockResolvedValue(undefined),
      updateDomains: vi.fn().mockResolvedValue(undefined),
      showItemInFolder: vi.fn().mockResolvedValue(undefined)
    },

    database: {
      selectFile: vi.fn().mockResolvedValue(null),
      selectSaveLocation: vi.fn().mockResolvedValue(null),
      open: vi.fn().mockResolvedValue({ success: true }),
      create: vi.fn().mockResolvedValue({ success: true }),
      rekey: vi.fn().mockResolvedValue({ success: true }),
      info: vi.fn().mockResolvedValue({ path: '/tmp/test.db', encrypted: false }),
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
      extractZip: vi.fn().mockResolvedValue([]),
      cleanupZipTemp: vi.fn().mockResolvedValue(undefined),
      onProgress: vi.fn(() => vi.fn()) // Returns cleanup function
    },

    cohort: {
      getVariants: vi.fn().mockResolvedValue({ data: [], total_count: 0 }),
      getSummary: vi.fn().mockResolvedValue({ totalCases: 0, totalVariants: 0 }),
      getCarriers: vi.fn().mockResolvedValue([]),
      getGeneBurden: vi.fn().mockResolvedValue([])
    },

    annotations: {
      getGlobal: vi.fn().mockResolvedValue(null),
      upsertGlobal: vi.fn().mockResolvedValue(undefined),
      deleteGlobal: vi.fn().mockResolvedValue(undefined),
      getPerCase: vi.fn().mockResolvedValue(null),
      upsertPerCase: vi.fn().mockResolvedValue(undefined),
      deletePerCase: vi.fn().mockResolvedValue(undefined),
      getForVariant: vi.fn().mockResolvedValue({ global: null, perCase: null })
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

    logs: {
      onMessage: vi.fn(() => vi.fn()) // Returns cleanup function
    }
  }
}
