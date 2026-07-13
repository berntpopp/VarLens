import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { useDatabaseStore } from '../../../src/renderer/src/stores/databaseStore'
import type {
  PostgresConnectionProfileInput,
  PostgresConnectionProfilePublic,
  PostgresConnectionProfileSaveInput
} from '../../../src/shared/types/postgres-profile'
import type { StorageCapabilities } from '../../../src/shared/types/storage-capabilities'

const POSTGRES_PROFILE: PostgresConnectionProfilePublic = {
  id: 'profile-1',
  name: 'Lab PostgreSQL',
  host: 'localhost',
  port: 5432,
  database: 'varlens',
  username: 'varlens',
  schema: 'public',
  sslMode: 'disable',
  poolMax: 5,
  connectionTimeoutMillis: 5000,
  statementTimeoutMs: 30000,
  lockTimeoutMs: 5000,
  idleInTransactionSessionTimeoutMs: 60000,
  caCertificateConfigured: false
}

const POSTGRES_PROFILE_INPUT: PostgresConnectionProfileInput = {
  name: POSTGRES_PROFILE.name,
  host: POSTGRES_PROFILE.host,
  port: POSTGRES_PROFILE.port,
  database: POSTGRES_PROFILE.database,
  username: POSTGRES_PROFILE.username,
  schema: POSTGRES_PROFILE.schema,
  sslMode: POSTGRES_PROFILE.sslMode,
  poolMax: POSTGRES_PROFILE.poolMax,
  connectionTimeoutMillis: POSTGRES_PROFILE.connectionTimeoutMillis,
  statementTimeoutMs: POSTGRES_PROFILE.statementTimeoutMs,
  lockTimeoutMs: POSTGRES_PROFILE.lockTimeoutMs,
  idleInTransactionSessionTimeoutMs: POSTGRES_PROFILE.idleInTransactionSessionTimeoutMs,
  secrets: {
    password: 'secret'
  }
}

const POSTGRES_CAPABILITIES: StorageCapabilities = {
  backend: 'postgres',
  workspace: {
    localFileLifecycle: false,
    hostedConnectionLifecycle: true,
    encryptionAtRest: false,
    migrations: false,
    healthDiagnostics: true
  },
  cases: {
    list: true,
    query: true,
    deleteOne: false,
    deleteMany: false,
    deleteAll: false,
    overview: false
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
    legacySearch: false,
    filterOptions: false,
    columnMeta: false,
    typeCounts: true,
    typesPresent: true,
    geneSymbols: true,
    panelFilters: false,
    tagFilters: false,
    commentFilters: false,
    acmgFilters: false,
    annotationFilters: false,
    inheritanceFilters: false,
    analysisGroupFilters: false,
    phasingFilters: false
  },
  workflow: {
    tags: false,
    annotations: false,
    caseComments: false,
    caseMetrics: false,
    filterPresets: false,
    panels: false,
    geneLists: false,
    regionFiles: false,
    analysisGroups: false,
    auditLog: false
  },
  cohort: {
    query: false,
    summary: false,
    rebuild: false,
    carriers: false,
    geneBurden: false,
    columnMeta: false
  },
  export: {
    variants: false,
    cohort: false,
    streaming: false
  }
}

describe('databaseStore.fetchInfo', () => {
  beforeEach(() => {
    setActivePinia(createPinia())

    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        database: {
          info: vi.fn().mockResolvedValue(null),
          recentList: vi.fn().mockResolvedValue([]),
          capabilities: vi.fn().mockResolvedValue(POSTGRES_CAPABILITIES),
          postgresProfilesList: vi.fn().mockResolvedValue([]),
          postgresProfileSave: vi
            .fn()
            .mockImplementation((input: PostgresConnectionProfileSaveInput) =>
              Promise.resolve({ ...POSTGRES_PROFILE, ...input, caCertificateConfigured: false })
            ),
          postgresProfileRemove: vi.fn().mockResolvedValue({ success: true }),
          postgresProfileTest: vi.fn().mockResolvedValue({
            ok: true,
            schema: POSTGRES_PROFILE.schema
          }),
          postgresProfileOpen: vi.fn().mockResolvedValue({
            success: true,
            info: {
              path: 'postgres://profile-1',
              name: POSTGRES_PROFILE.name,
              encrypted: false
            }
          })
        }
      }
    })
  })

  it('clears stale sqlite metadata when database:info returns null', async () => {
    const store = useDatabaseStore()

    store.currentPath = '/tmp/old.db'
    store.currentName = 'old.db'
    store.isEncrypted = true
    store.keyManaged = true

    await store.fetchInfo()

    expect(store.currentPath).toBeNull()
    expect(store.currentName).toBe('')
    expect(store.isEncrypted).toBe(false)
    expect(store.keyManaged).toBe(false)
  })

  it('BLOCKER 1: applyInfo picks up keyManaged from database:info (defaulting to false when absent)', async () => {
    const store = useDatabaseStore()
    const infoMock = window.api.database.info as ReturnType<typeof vi.fn>

    infoMock.mockResolvedValueOnce({
      path: '/tmp/managed.db',
      name: 'managed.db',
      encrypted: true,
      keyManaged: true
    })
    await store.fetchInfo()
    expect(store.keyManaged).toBe(true)

    infoMock.mockResolvedValueOnce({
      path: '/tmp/legacy.db',
      name: 'legacy.db',
      encrypted: true
    })
    await store.fetchInfo()
    expect(store.keyManaged).toBe(false)
  })

  it('loads postgres profiles through the database API', async () => {
    vi.mocked(window.api.database.postgresProfilesList).mockResolvedValue([POSTGRES_PROFILE])
    const store = useDatabaseStore()

    await store.fetchPostgresProfiles()

    expect(window.api.database.postgresProfilesList).toHaveBeenCalledOnce()
    expect(store.postgresProfiles).toEqual([POSTGRES_PROFILE])
  })

  it('tests postgres input without mutating current database state', async () => {
    const store = useDatabaseStore()
    store.currentPath = '/tmp/current.db'
    store.currentName = 'current.db'
    store.isEncrypted = true

    const result = await store.testPostgresProfile(POSTGRES_PROFILE_INPUT)

    expect(window.api.database.postgresProfileTest).toHaveBeenCalledWith(POSTGRES_PROFILE_INPUT)
    expect(result).toEqual({ ok: true, schema: POSTGRES_PROFILE.schema })
    expect(store.currentPath).toBe('/tmp/current.db')
    expect(store.currentName).toBe('current.db')
    expect(store.isEncrypted).toBe(true)
  })

  it('opens a postgres profile and refreshes metadata, capabilities, recents, and profiles', async () => {
    vi.mocked(window.api.database.postgresProfilesList).mockResolvedValue([POSTGRES_PROFILE])
    const store = useDatabaseStore()

    const result = await store.openPostgresProfile(POSTGRES_PROFILE.id)

    expect(window.api.database.postgresProfileOpen).toHaveBeenCalledWith(POSTGRES_PROFILE.id)
    expect(result).toEqual({
      success: true,
      info: {
        path: 'postgres://profile-1',
        name: POSTGRES_PROFILE.name,
        encrypted: false
      }
    })
    expect(store.currentPath).toBe('postgres://profile-1')
    expect(store.currentName).toBe(POSTGRES_PROFILE.name)
    expect(store.isEncrypted).toBe(false)
    expect(store.capabilities).toEqual(POSTGRES_CAPABILITIES)
    expect(window.api.database.recentList).toHaveBeenCalled()
    expect(window.api.database.postgresProfilesList).toHaveBeenCalled()
    expect(store.postgresProfiles).toEqual([POSTGRES_PROFILE])
  })
})
