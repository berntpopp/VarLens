/**
 * Preload contract test
 *
 * Ensures that the WindowAPI interface (type definition), the preload
 * `const api` object (runtime implementation), and the test mockApi type
 * all expose the same top-level domain keys.
 *
 * This is a source-parsing test that reads the actual source files and
 * extracts keys via regex, ensuring contract alignment without imports
 * that would pull in Electron dependencies.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { ErrorCode } from '../../../src/shared/types/errors'
import type { WindowAPI, BatchAnnotationKey } from '../../../src/shared/types/api'
import type { ImportResult } from '../../../src/shared/types/import'
import { DEBUG_CHANNELS } from '../../../src/shared/ipc/domains/debug'
import { JOBS_CHANNELS } from '../../../src/shared/ipc/domains/jobs'

const ROOT = resolve(__dirname, '..', '..', '..')

const DOMAIN_CONTRACT_PATHS: Record<string, string> = {
  CasesDomainContract: 'src/shared/ipc/domains/cases.ts',
  DatabaseDomainContract: 'src/shared/ipc/domains/database.ts',
  FilterPresetsDomainContract: 'src/shared/ipc/domains/filter-presets.ts',
  DebugApi: 'src/shared/ipc/domains/debug.ts',
  JobsApi: 'src/shared/ipc/domains/jobs.ts',
  CaseMetadataDomainContract: 'src/shared/ipc/domains/case-metadata.ts',
  ImportDomainContract: 'src/shared/ipc/domains/import.ts',
  AuthDomainContract: 'src/shared/ipc/domains/auth.ts'
}

/**
 * Extract top-level property keys from the WindowAPI interface definition.
 * Matches lines like: `  cases: CasesAPI`
 */
function extractWindowApiKeys(): string[] {
  const content = readFileSync(resolve(ROOT, 'src/shared/types/api.ts'), 'utf-8')

  // Find the WindowAPI interface block
  const interfaceMatch = content.match(/export interface WindowAPI\s*\{([^}]+)\}/)
  if (!interfaceMatch) throw new Error('Could not find WindowAPI interface in api.ts')

  const body = interfaceMatch[1]
  const keys: string[] = []
  // Match property names (word chars before the colon)
  for (const line of body.split('\n')) {
    const match = line.match(/^\s+(\w+)\s*:/)
    if (match) {
      keys.push(match[1])
    }
  }
  return keys.sort()
}

/**
 * Extract top-level keys from the preload `const api = { ... }` object.
 * Matches lines like: `  cases: {` at the top nesting level.
 */
function extractPreloadApiKeys(): string[] {
  const content = readFileSync(
    resolve(ROOT, 'src/preload/window-api/create-window-api.ts'),
    'utf-8'
  )

  // Find the WindowAPI assembly object returned by createWindowApi().
  const match = content.match(/return\s+\{/)
  if (!match) throw new Error('Could not find preload api object in create-window-api.ts')
  const startIdx = match.index ?? -1
  if (startIdx === -1) throw new Error('Could not find preload api object in create-window-api.ts')

  // Track brace depth to find the matching closing brace
  let depth = 0
  let inBlock = false
  const keys: string[] = []
  const lines = content.slice(startIdx).split('\n')

  for (const line of lines) {
    // Check match BEFORE updating depth for this line
    // Top-level keys are at depth === 1 (inside the outer object)
    // They look like: `  someName: core.someName` or `  someName: {`
    if (depth === 1) {
      const match = line.match(/^\s+(\w+)\s*:/)
      if (match) {
        keys.push(match[1])
      }
    }

    for (const ch of line) {
      if (ch === '{') {
        depth++
        inBlock = true
      }
      if (ch === '}') depth--
    }

    if (inBlock && depth === 0) break
  }

  return keys.sort()
}

/**
 * Extract top-level keys from the MockApi type in mock-api.ts.
 * Matches lines like: `  cases: {` at the type-level.
 */
function extractMockApiKeys(): string[] {
  const content = readFileSync(resolve(ROOT, 'tests/utils/mock-api.ts'), 'utf-8')

  // Find `export type MockApi = {` block
  const typeMatch = content.match(/export type MockApi\s*=\s*\{/)
  if (!typeMatch) throw new Error('Could not find MockApi type in mock-api.ts')

  const startIdx = content.indexOf(typeMatch[0])
  let depth = 0
  let inBlock = false
  const keys: string[] = []
  const lines = content.slice(startIdx).split('\n')

  for (const line of lines) {
    // Check match BEFORE updating depth
    if (depth === 1) {
      const match = line.match(/^\s+(\w+)\s*:/)
      if (match) {
        keys.push(match[1])
      }
    }

    for (const ch of line) {
      if (ch === '{') {
        depth++
        inBlock = true
      }
      if (ch === '}') depth--
    }

    if (inBlock && depth === 0) break
  }

  return keys.sort()
}

/**
 * Extract method keys for a specific API sub-interface from api.ts.
 * Uses brace-depth tracking to handle nested object types in return signatures
 * (e.g., `Promise<{ data: T[]; total_count: number }>`).
 */
function extractSubInterfaceKeys(interfaceName: string): string[] {
  const content = readFileSync(resolve(ROOT, 'src/shared/types/api.ts'), 'utf-8')

  // Find the start of the interface
  const startMarker = `export interface ${interfaceName}`
  const startIdx = content.indexOf(startMarker)
  if (startIdx === -1) {
    const directAliasMatch = content.match(
      new RegExp(`export type ${interfaceName}\\s*=\\s*(\\w+)`)
    )
    if (directAliasMatch) {
      const domainPath = DOMAIN_CONTRACT_PATHS[directAliasMatch[1]]
      if (!domainPath) return []

      return extractInterfaceKeysFromFile(domainPath, directAliasMatch[1])
    }

    const typeAliasMatch = content.match(
      new RegExp(`export type ${interfaceName}\\s*=\\s*RendererApiFromDomain<(\\w+)>`)
    )
    if (!typeAliasMatch) return []

    const domainPath = DOMAIN_CONTRACT_PATHS[typeAliasMatch[1]]
    if (!domainPath) return []

    return extractInterfaceKeysFromFile(domainPath, typeAliasMatch[1])
  }

  // Track brace depth to find the matching closing brace
  const lines = content.slice(startIdx).split('\n')
  let depth = 0
  let inBlock = false
  const keys: string[] = []

  for (const line of lines) {
    // Top-level properties are at depth === 1 (inside the outer interface brace)
    if (depth === 1) {
      const m = line.match(/^\s+(\w+)\s*:/)
      if (m) keys.push(m[1])
    }

    for (const ch of line) {
      if (ch === '{') {
        depth++
        inBlock = true
      }
      if (ch === '}') depth--
    }

    if (inBlock && depth === 0) break
  }

  const extendsMatch = content
    .slice(startIdx)
    .match(
      new RegExp(`export interface ${interfaceName}\\s+extends\\s+RendererApiFromDomain<(\\w+)>`)
    )
  if (extendsMatch) {
    const domainPath = DOMAIN_CONTRACT_PATHS[extendsMatch[1]]
    if (!domainPath) return keys.sort()

    const inheritedKeys = extractInterfaceKeysFromFile(domainPath, extendsMatch[1])
    return [...new Set([...keys, ...inheritedKeys])].sort()
  }

  const directExtendsMatch = content
    .slice(startIdx)
    .match(new RegExp(`export interface ${interfaceName}\\s+extends\\s+(\\w+)`))
  if (directExtendsMatch) {
    const domainPath = DOMAIN_CONTRACT_PATHS[directExtendsMatch[1]]
    if (!domainPath) return keys.sort()

    const inheritedKeys = extractInterfaceKeysFromFile(domainPath, directExtendsMatch[1])
    return [...new Set([...keys, ...inheritedKeys])].sort()
  }

  return keys.sort()
}

function extractInterfaceKeysFromFile(filePath: string, interfaceName: string): string[] {
  const content = readFileSync(resolve(ROOT, filePath), 'utf-8')
  const startMarker = `export interface ${interfaceName}`
  const startIdx = content.indexOf(startMarker)
  if (startIdx === -1) return []

  const lines = content.slice(startIdx).split('\n')
  let depth = 0
  let inBlock = false
  const keys: string[] = []

  for (const line of lines) {
    if (depth === 1) {
      const match = line.match(/^\s+(\w+)\s*:/)
      if (match) keys.push(match[1])
    }

    for (const ch of line) {
      if (ch === '{') {
        depth++
        inBlock = true
      }
      if (ch === '}') depth--
    }

    if (inBlock && depth === 0) break
  }

  return keys.sort()
}

describe('Preload contract — per-module method alignment', () => {
  const apiContent = readFileSync(resolve(ROOT, 'src/shared/types/api.ts'), 'utf-8')

  // Extract module→interface mapping from WindowAPI
  const windowApiBlock = apiContent.match(/export interface WindowAPI\s*\{([^}]+)\}/)
  if (!windowApiBlock) throw new Error('Cannot find WindowAPI')

  const moduleEntries: Array<{ key: string; interfaceName: string }> = []
  for (const line of windowApiBlock[1].split('\n')) {
    const match = line.match(/^\s+(\w+)\s*:\s*(\w+)/)
    if (match) {
      moduleEntries.push({ key: match[1], interfaceName: match[2] })
    }
  }

  for (const { key, interfaceName } of moduleEntries) {
    it(`${key} (${interfaceName}) has methods defined`, () => {
      const methods = extractSubInterfaceKeys(interfaceName)
      expect(methods.length).toBeGreaterThan(0)
    })
  }
})

describe('Preload contract alignment', () => {
  const windowApiKeys = extractWindowApiKeys()
  const preloadKeys = extractPreloadApiKeys()
  const mockApiKeys = extractMockApiKeys()
  const preloadSource = readFileSync(resolve(ROOT, 'src/preload/index.ts'), 'utf-8')
  const createWindowApiSource = readFileSync(
    resolve(ROOT, 'src/preload/window-api/create-window-api.ts'),
    'utf-8'
  )
  const domainFactorySource = readFileSync(
    resolve(ROOT, 'src/preload/window-api/domains.ts'),
    'utf-8'
  )
  const coreApiSource = readFileSync(resolve(ROOT, 'src/preload/window-api/core-api.ts'), 'utf-8')
  const appApiSource = readFileSync(resolve(ROOT, 'src/preload/window-api/app-api.ts'), 'utf-8')
  const casesDomainSource = readFileSync(resolve(ROOT, 'src/preload/domains/cases.ts'), 'utf-8')
  const databaseDomainSource = readFileSync(
    resolve(ROOT, 'src/preload/domains/database.ts'),
    'utf-8'
  )
  const filterPresetsDomainSource = readFileSync(
    resolve(ROOT, 'src/preload/domains/filter-presets.ts'),
    'utf-8'
  )

  it('WindowAPI interface has expected keys', () => {
    expect(windowApiKeys.length).toBeGreaterThan(10)
  })

  it('preload const api has expected keys', () => {
    expect(preloadKeys.length).toBeGreaterThan(10)
  })

  it('import and auth preload objects are checked without contract-bypassing casts', () => {
    expect(coreApiSource).not.toContain("as WindowAPI['import']")
    expect(appApiSource).not.toContain("as WindowAPI['auth']")
  })

  it('preload imports the cases domain factory', () => {
    expect(domainFactorySource).toContain("import { createCasesApi } from '../domains/cases'")
  })

  it('preload imports the database and filter presets domain factories', () => {
    expect(domainFactorySource).toContain("import { createDatabaseApi } from '../domains/database'")
    expect(domainFactorySource).toContain(
      "import { createFilterPresetsApi } from '../domains/filter-presets'"
    )
  })

  it('cases preload domain uses the shared domain contract boundary', () => {
    expect(casesDomainSource).toContain(
      "import type { CasesDomainContract } from '../../shared/ipc/domains/cases'"
    )
    expect(casesDomainSource).toContain('export function createCasesApi(): CasesDomainContract')
    expect(casesDomainSource).not.toContain('unwrapIpcResult')
    expect(casesDomainSource).toContain(
      "deleteBatch: (ids) => ipcRenderer.invoke('cases:deleteBatch', ids)"
    )
    expect(casesDomainSource).toContain(
      "availableBuilds: () => ipcRenderer.invoke('cases:availableBuilds')"
    )
  })

  it('database preload domain uses the shared domain contract boundary', () => {
    expect(databaseDomainSource).toContain(
      "import type { DatabaseDomainContract } from '../../shared/ipc/domains/database'"
    )
    expect(databaseDomainSource).toContain(
      'export function createDatabaseApi(): DatabaseDomainContract'
    )
    expect(databaseDomainSource).not.toContain('unwrapIpcResult')
    expect(databaseDomainSource).toContain("info: () => ipcRenderer.invoke('database:info')")
    expect(databaseDomainSource).toContain('postgresProfilesList:')
    expect(databaseDomainSource).toContain("'database:postgresProfilesList'")
    expect(databaseDomainSource).toContain('postgresProfileSave:')
    expect(databaseDomainSource).toContain("'database:postgresProfileSave'")
    expect(databaseDomainSource).toContain('postgresProfileRemove:')
    expect(databaseDomainSource).toContain("'database:postgresProfileRemove'")
    expect(databaseDomainSource).toContain('postgresProfileTest:')
    expect(databaseDomainSource).toContain("'database:postgresProfileTest'")
    expect(databaseDomainSource).toContain('postgresProfileOpen:')
    expect(databaseDomainSource).toContain("'database:postgresProfileOpen'")
    expect(coreApiSource).toContain(
      'postgresProfilesList: () => databaseDomain.postgresProfilesList()'
    )
    expect(coreApiSource).toContain(
      'postgresProfileSave: (input) => databaseDomain.postgresProfileSave(input)'
    )
    expect(coreApiSource).toContain(
      'postgresProfileRemove: (profileId) => databaseDomain.postgresProfileRemove(profileId)'
    )
    expect(coreApiSource).toContain(
      'postgresProfileTest: (input) => databaseDomain.postgresProfileTest(input)'
    )
    expect(coreApiSource).toContain(
      'postgresProfileOpen: (profileId) => databaseDomain.postgresProfileOpen(profileId)'
    )
    expect(databaseDomainSource).toContain(
      "showInFolder: (path) => ipcRenderer.invoke('database:showInFolder', path)"
    )
    expect(databaseDomainSource).toContain(
      "migrateToEncrypted: (options) => ipcRenderer.invoke('database:migrateToEncrypted', options)"
    )
    expect(databaseDomainSource).toContain("'database:deletePlaintextBackup'")
    expect(databaseDomainSource).toContain('setRecoveryPassphrase:')
    expect(databaseDomainSource).toContain("'database:setRecoveryPassphrase'")
    expect(preloadSource).not.toContain('unwrapIpcResult(await databaseDomain.open')
  })

  it('filter presets preload domain uses the shared domain contract boundary', () => {
    expect(filterPresetsDomainSource).toContain(
      "import type { FilterPresetsDomainContract } from '../../shared/ipc/domains/filter-presets'"
    )
    expect(filterPresetsDomainSource).toContain(
      'export function createFilterPresetsApi(): FilterPresetsDomainContract'
    )
    expect(filterPresetsDomainSource).not.toContain('unwrapIpcResult')
    expect(filterPresetsDomainSource).toContain("list: () => ipcRenderer.invoke('presets:list')")
    expect(filterPresetsDomainSource).toContain(
      "reorder: (items) => ipcRenderer.invoke('presets:reorder', items)"
    )
    expect(preloadSource).not.toContain('unwrapIpcResult(await filterPresetsDomain.list')
  })

  it('mockApi type has expected keys', () => {
    expect(mockApiKeys.length).toBeGreaterThan(10)
  })

  it('preload api keys match WindowAPI interface keys', () => {
    const missingInPreload = windowApiKeys.filter((k) => !preloadKeys.includes(k))
    const extraInPreload = preloadKeys.filter((k) => !windowApiKeys.includes(k))

    if (missingInPreload.length > 0 || extraInPreload.length > 0) {
      const msgs: string[] = []
      if (missingInPreload.length > 0) {
        msgs.push(`Missing in preload: ${missingInPreload.join(', ')}`)
      }
      if (extraInPreload.length > 0) {
        msgs.push(`Extra in preload: ${extraInPreload.join(', ')}`)
      }
      expect.fail(msgs.join('; '))
    }
  })

  it('mockApi keys match WindowAPI interface keys', () => {
    const missingInMock = windowApiKeys.filter((k) => !mockApiKeys.includes(k))
    const extraInMock = mockApiKeys.filter((k) => !windowApiKeys.includes(k))

    if (missingInMock.length > 0 || extraInMock.length > 0) {
      const msgs: string[] = []
      if (missingInMock.length > 0) {
        msgs.push(`Missing in mockApi: ${missingInMock.join(', ')}`)
      }
      if (extraInMock.length > 0) {
        msgs.push(`Extra in mockApi: ${extraInMock.join(', ')}`)
      }
      expect.fail(msgs.join('; '))
    }
  })

  it('preload domain modules and WindowAPI stay aligned', () => {
    expect(preloadKeys).toEqual(windowApiKeys)
    expect(createWindowApiSource).toContain('export function createWindowApi(): WindowAPI')
    expect(preloadSource).toContain(
      "import { createWindowApi } from './window-api/create-window-api'"
    )
  })

  it('mockApi keys match WindowAPI interface keys exactly', () => {
    expect(mockApiKeys).toEqual(windowApiKeys)
  })

  // The compile-time half of this check (CasesListReturn/CohortRunAssociationReturn
  // must equal IpcResult<...>) lives in preload-contract.test-d.ts — see that
  // file's docblock for why `expectTypeOf(...).toEqualTypeOf(...)` is a
  // runtime no-op and must run under a real typechecker to mean anything.
  it('exposes IpcResult for scoped wrapHandler-backed methods (source strings)', () => {
    const apiSource = readFileSync(resolve(ROOT, 'src/shared/types/api.ts'), 'utf-8')

    expect(apiSource).toContain('export type CasesAPI = CasesDomainContract')
    expect(apiSource).toContain('getSummary: () => Promise<IpcResult<CohortSummary>>')
    expect(apiSource).toContain('runAssociation: (config: unknown) => Promise<IpcResult<unknown>>')
  })
})

describe('cases preload domain behavior', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.resetModules()
    vi.doUnmock('electron')
    delete (process as typeof process & { contextIsolated?: boolean }).contextIsolated
  })

  it('forwards all cases domain channels without unwrapping in createCasesApi', async () => {
    const invoke = vi
      .fn()
      .mockResolvedValueOnce([{ id: 1, name: 'Case Alpha' }])
      .mockResolvedValueOnce({ data: [], total_count: 0 })
      .mockResolvedValueOnce({
        code: ErrorCode.DB_ERROR,
        message: 'delete failed',
        userMessage: 'Could not delete case'
      })
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce([{ build: 'GRCh38', caseCount: 4 }])

    vi.doMock('electron', () => ({
      ipcRenderer: { invoke }
    }))

    const { createCasesApi } = await import('../../../src/preload/domains/cases')
    const api = createCasesApi()

    await expect(api.list()).resolves.toEqual([{ id: 1, name: 'Case Alpha' }])
    await expect(api.query({ limit: 50, offset: 0 })).resolves.toEqual({ data: [], total_count: 0 })
    await expect(api.delete(7)).resolves.toEqual({
      code: ErrorCode.DB_ERROR,
      message: 'delete failed',
      userMessage: 'Could not delete case'
    })
    await expect(api.deleteAll()).resolves.toBe(3)
    await expect(api.deleteBatch([1, 2])).resolves.toBe(2)
    await expect(api.availableBuilds()).resolves.toEqual([{ build: 'GRCh38', caseCount: 4 }])

    expect(invoke).toHaveBeenNthCalledWith(1, 'cases:list')
    expect(invoke).toHaveBeenNthCalledWith(2, 'cases:query', { limit: 50, offset: 0 })
    expect(invoke).toHaveBeenNthCalledWith(3, 'cases:delete', 7)
    expect(invoke).toHaveBeenNthCalledWith(4, 'cases:deleteAll')
    expect(invoke).toHaveBeenNthCalledWith(5, 'cases:deleteBatch', [1, 2])
    expect(invoke).toHaveBeenNthCalledWith(6, 'cases:availableBuilds')
  })

  it('preload index preserves cases transport results when exposing window.api', async () => {
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'cases:list' || channel === 'cases:deleteBatch') {
        return {
          code: ErrorCode.DB_ERROR,
          message: `${channel} failed`,
          userMessage: `Could not run ${channel}`
        }
      }
      if (channel === 'cases:availableBuilds') {
        return [{ build: 'GRCh38', caseCount: 2 }]
      }
      return undefined
    })
    const exposeInMainWorld = vi.fn()

    vi.doMock('electron', () => ({
      contextBridge: { exposeInMainWorld },
      ipcRenderer: {
        invoke,
        on: vi.fn(),
        removeListener: vi.fn(),
        send: vi.fn()
      }
    }))
    ;(process as typeof process & { contextIsolated?: boolean }).contextIsolated = true

    await import('../../../src/preload/index')

    const api = exposeInMainWorld.mock.calls[0]?.[1] as {
      cases: {
        list: () => Promise<unknown>
        deleteBatch: (ids: number[]) => Promise<unknown>
        availableBuilds: () => Promise<unknown>
      }
    }

    await expect(api.cases.list()).resolves.toMatchObject({
      code: ErrorCode.DB_ERROR,
      message: 'cases:list failed'
    })
    await expect(api.cases.deleteBatch([8, 9])).resolves.toMatchObject({
      code: ErrorCode.DB_ERROR,
      message: 'cases:deleteBatch failed'
    })
    await expect(api.cases.availableBuilds()).resolves.toEqual([{ build: 'GRCh38', caseCount: 2 }])

    expect(invoke).toHaveBeenCalledWith('cases:list')
    expect(invoke).toHaveBeenCalledWith('cases:deleteBatch', [8, 9])
    expect(invoke).toHaveBeenCalledWith('cases:availableBuilds')
  })
})

describe('annotations.batchGet — A1 contract extension', () => {
  it('BatchAnnotationKey carries optional variantId (Pass-8 #1)', () => {
    const coordsOnly: BatchAnnotationKey = { chr: 'chr1', pos: 1, ref: 'A', alt: 'G' }
    const withId: BatchAnnotationKey = { chr: 'chr1', pos: 1, ref: 'A', alt: 'G', variantId: 42 }
    // Compile-time assertion: both shapes type-check. Runtime no-op.
    expect(coordsOnly.chr).toBe('chr1')
    expect(withId.variantId).toBe(42)
  })
})

describe('debug domain — Sprint A PR-2 Gate 10c', () => {
  it('exposes queryCountersGet + queryCountersReset channel names', () => {
    expect(DEBUG_CHANNELS.queryCountersGet).toBe('debug:queryCounters:get')
    expect(DEBUG_CHANNELS.queryCountersReset).toBe('debug:queryCounters:reset')
  })

  it('WindowAPI carries a debug top-level key wired to the DebugApi contract', () => {
    const apiKeys = extractWindowApiKeys()
    expect(apiKeys).toContain('debug')

    const debugMethods = extractSubInterfaceKeys('DebugAPI')
    expect(debugMethods).toEqual(['queryCountersGet', 'queryCountersReset'])
  })

  it('create-window-api assembles the debug domain', () => {
    const source = readFileSync(
      resolve(ROOT, 'src/preload/window-api/create-window-api.ts'),
      'utf-8'
    )
    expect(source).toContain("import { createDebugApi } from '../domains/debug'")
    expect(source).toContain('debug: createDebugApi()')
  })

  // Compile-time check moved to preload-contract.test-d.ts — see that
  // file's docblock for why an `expectTypeOf` assertion left in a plain
  // `.test.ts` file never actually runs under a typechecker.
})

describe('jobs domain — Sprint A PR-4 Gate 11', () => {
  it('exposes jobs:list / jobs:get / jobs:progress', () => {
    expect(JOBS_CHANNELS.list).toBe('jobs:list')
    expect(JOBS_CHANNELS.get).toBe('jobs:get')
    expect(JOBS_CHANNELS.progress).toBe('jobs:progress')
  })

  it('WindowAPI carries a jobs top-level key wired to the JobsApi contract', () => {
    const apiKeys = extractWindowApiKeys()
    expect(apiKeys).toContain('jobs')

    const jobsMethods = extractSubInterfaceKeys('JobsAPI')
    expect(jobsMethods).toEqual(['get', 'list', 'progress'])
  })

  it('create-window-api assembles the jobs domain', () => {
    const source = readFileSync(
      resolve(ROOT, 'src/preload/window-api/create-window-api.ts'),
      'utf-8'
    )
    expect(source).toContain("import { createJobsApi } from '../domains/jobs'")
    expect(source).toContain('jobs: createJobsApi()')
  })

  it('main process registers the jobs handlers', () => {
    const source = readFileSync(resolve(ROOT, 'src/main/ipc/index.ts'), 'utf-8')
    expect(source).toContain("import { registerJobsHandlers } from './domains/jobs'")
    expect(source).toContain('registerJobsHandlers()')
  })

  // Compile-time checks (jobs list/get/progress return IpcResult; the
  // import:start contract is unchanged) moved to preload-contract.test-d.ts.

  it('existing import contract is unchanged by the jobs domain (source string)', () => {
    // Byte-identity guard: the import:progress event channel must be
    // untouched by PR-4. The type-level half of this guard (the
    // import:start return-type shape) lives in preload-contract.test-d.ts.
    const coreApiSource = readFileSync(resolve(ROOT, 'src/preload/window-api/core-api.ts'), 'utf-8')
    expect(coreApiSource).toContain("subscribeToIpcEvent('import:progress', callback)")
  })
})

/**
 * Return the brace-balanced body of `export interface <name> { ... }` from a
 * source string (used by Gate 10b to assert import-result types stay
 * warnings-free without importing main-process modules).
 */
function extractInterfaceBlock(source: string, interfaceName: string): string {
  const startIdx = source.indexOf(`export interface ${interfaceName}`)
  if (startIdx === -1) throw new Error(`interface ${interfaceName} not found`)
  const braceStart = source.indexOf('{', startIdx)
  let depth = 0
  for (let i = braceStart; i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}') {
      depth--
      if (depth === 0) return source.slice(braceStart, i + 1)
    }
  }
  throw new Error(`unbalanced braces for interface ${interfaceName}`)
}

describe('cohort domain — Sprint A PR-3 Gate 10b', () => {
  it('cohort getVariants response carries an optional warnings field', () => {
    type CohortGetVariantsReturn = Awaited<ReturnType<WindowAPI['cohort']['getVariants']>>

    // A response without warnings still satisfies the type (warnings optional).
    const withoutWarnings: CohortGetVariantsReturn = {
      data: [],
      total_count: 0
    }
    // A response carrying warnings.staleSummary also type-checks.
    const withWarnings: CohortGetVariantsReturn = {
      data: [],
      total_count: 0,
      warnings: { staleSummary: true }
    }

    expect(withoutWarnings.warnings).toBeUndefined()
    expect(withWarnings.warnings?.staleSummary).toBe(true)
  })

  // 'getSummaryStatus contract shape is unchanged' compile-time check moved
  // to preload-contract.test-d.ts.

  it('ImportResult shape unchanged — no warnings field (Pass-4 HIGH #3)', () => {
    const result: ImportResult = {
      caseId: 1,
      variantCount: 0,
      skipped: 0,
      errors: [],
      elapsed: 0
    }
    // @ts-expect-error — warnings is intentionally NOT on ImportResult
    void result.warnings
    expect(result.caseId).toBe(1)
  })

  it('StorageImportSingleFileResult + PostgresImportWorkerCompleteMessage stay warnings-free', () => {
    const importExecutorSource = readFileSync(
      resolve(ROOT, 'src/main/storage/import-executor.ts'),
      'utf-8'
    )
    const postgresWorkerSource = readFileSync(
      resolve(ROOT, 'src/shared/types/postgres-import-worker.ts'),
      'utf-8'
    )

    const singleFileBlock = extractInterfaceBlock(
      importExecutorSource,
      'StorageImportSingleFileResult'
    )
    const completeBlock = extractInterfaceBlock(
      postgresWorkerSource,
      'PostgresImportWorkerCompleteMessage'
    )

    expect(singleFileBlock).not.toContain('warnings')
    expect(completeBlock).not.toContain('warnings')
  })
})

describe('debug preload domain behavior', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.resetModules()
    vi.doUnmock('electron')
  })

  it('forwards both debug channels through ipcRenderer.invoke', async () => {
    const invoke = vi
      .fn()
      .mockResolvedValueOnce({ named: {}, unnamed: 0, enabled: false })
      .mockResolvedValueOnce({ enabled: false })

    vi.doMock('electron', () => ({ ipcRenderer: { invoke } }))

    const { createDebugApi } = await import('../../../src/preload/domains/debug')
    const api = createDebugApi()

    await expect(api.queryCountersGet()).resolves.toEqual({
      named: {},
      unnamed: 0,
      enabled: false
    })
    await expect(api.queryCountersReset()).resolves.toEqual({ enabled: false })

    expect(invoke).toHaveBeenNthCalledWith(1, 'debug:queryCounters:get')
    expect(invoke).toHaveBeenNthCalledWith(2, 'debug:queryCounters:reset')
  })
})

describe('case-metadata domain — Task A4 IpcResult laundering guard', () => {
  const apiSource = readFileSync(resolve(ROOT, 'src/shared/types/api.ts'), 'utf-8')
  const appApiSource = readFileSync(resolve(ROOT, 'src/preload/window-api/app-api.ts'), 'utf-8')

  it('WindowAPI caseMetadata is aliased to the honest domain contract, not a laundered interface', () => {
    // A prior `CaseMetadataAPI` interface declared plain `Promise<T>` returns
    // (e.g. `upsert`, `getDataInfo`, `createCohort`) instead of
    // `Promise<IpcResult<T>>`, even though `wrapHandler` always resolves an
    // `IpcResult<T>` at runtime. That let a raw, un-unwrapped assignment
    // (the C1 bug class) pass `tsc` silently. Locking the alias here means a
    // future edit can't reintroduce a hand-written, laundered interface.
    expect(apiSource).toContain('export type CaseMetadataAPI = CaseMetadataDomainContract')
  })

  it('preload no longer launders caseMetadata through an `as WindowAPI[...]` cast', () => {
    expect(appApiSource).not.toContain("as WindowAPI['caseMetadata']")
  })

  // The two compile-time checks that used to live here (WindowAPI
  // caseMetadata methods return IpcResult — the C1 regression guard — and
  // WindowAPI geneLists methods return IpcResult) moved to
  // preload-contract.test-d.ts, which actually runs under a typechecker.
  // See PR-A Item 3: `expectTypeOf(...).toEqualTypeOf(...)` is a runtime
  // no-op (`expect-type`'s implementation is literally `() => true`), so
  // leaving these assertions in a plain `.test.ts` file — never covered by
  // `make typecheck` (tests/ is outside tsconfig.node.json/tsconfig.renderer.json)
  // nor by `vitest run` (no typecheck mode) — made them inert: reverting
  // `CaseMetadataAPI` to a naked `Promise<T>` would not fail any command.
})
