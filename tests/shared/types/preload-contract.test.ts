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

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const ROOT = resolve(__dirname, '..', '..', '..')

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
  const content = readFileSync(resolve(ROOT, 'src/preload/index.ts'), 'utf-8')

  // Find `const api = {` and extract until the matching closing brace
  const startIdx = content.indexOf('const api = {')
  if (startIdx === -1) throw new Error('Could not find `const api = {` in preload/index.ts')

  // Track brace depth to find the matching closing brace
  let depth = 0
  let inBlock = false
  const keys: string[] = []
  const lines = content.slice(startIdx).split('\n')

  for (const line of lines) {
    // Check match BEFORE updating depth for this line
    // Top-level keys are at depth === 1 (inside the outer object)
    // They look like: `  someName: {` or `  someName: (`
    if (depth === 1) {
      const match = line.match(/^\s+(\w+)\s*:\s*[{(]/)
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
      const match = line.match(/^\s+(\w+)\s*:\s*\{/)
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
  if (startIdx === -1) return []

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

  it('WindowAPI interface has expected keys', () => {
    expect(windowApiKeys.length).toBeGreaterThan(10)
  })

  it('preload const api has expected keys', () => {
    expect(preloadKeys.length).toBeGreaterThan(10)
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

  it('all three sources have identical top-level keys', () => {
    expect(preloadKeys).toEqual(windowApiKeys)
    expect(mockApiKeys).toEqual(windowApiKeys)
  })
})
