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

import { describe, it, expect, expectTypeOf, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { ErrorCode } from '../../../src/shared/types/errors'
import type { WindowAPI, Case } from '../../../src/shared/types/api'
import type { IpcResult } from '../../../src/shared/types/errors'

const ROOT = resolve(__dirname, '..', '..', '..')

const DOMAIN_CONTRACT_PATHS: Record<string, string> = {
  CasesDomainContract: 'src/shared/ipc/domains/cases.ts',
  DatabaseDomainContract: 'src/shared/ipc/domains/database.ts',
  FilterPresetsDomainContract: 'src/shared/ipc/domains/filter-presets.ts'
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

  it('exposes IpcResult for scoped wrapHandler-backed methods', () => {
    type CasesListReturn = Awaited<ReturnType<WindowAPI['cases']['list']>>
    type CohortRunAssociationReturn = Awaited<ReturnType<WindowAPI['cohort']['runAssociation']>>
    const apiSource = readFileSync(resolve(ROOT, 'src/shared/types/api.ts'), 'utf-8')

    expectTypeOf<CasesListReturn>().toEqualTypeOf<IpcResult<Case[]>>()
    expectTypeOf<CohortRunAssociationReturn>().toEqualTypeOf<IpcResult<unknown>>()

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
