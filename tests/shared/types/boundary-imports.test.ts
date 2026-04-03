/**
 * Boundary guard test
 *
 * Ensures that src/shared/ never imports from src/main/.
 * This prevents architecture drift where the shared layer
 * depends on main-process internals.
 *
 * Uses pure Node.js file scanning (no grep) for cross-platform compatibility.
 */

import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'fs'
import { resolve } from 'path'

const ROOT = resolve(__dirname, '..', '..', '..')

/** Recursively collect all .ts files under a directory. */
function getTypeScriptFiles(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir)) {
    const fullPath = resolve(dir, entry)
    const stats = statSync(fullPath)
    if (stats.isDirectory()) {
      files.push(...getTypeScriptFiles(fullPath))
    } else if (stats.isFile() && fullPath.endsWith('.ts')) {
      files.push(fullPath)
    }
  }
  return files
}

/** Check if a line contains an import/export from a main/ path. */
function hasMainImport(line: string): boolean {
  return /(?:import|export)\s.*from\s+['"].*main\//.test(line)
}

describe('Shared layer boundary', () => {
  it('src/shared/ has no imports from src/main/', () => {
    const sharedRoot = resolve(ROOT, 'src/shared/')
    const violations: string[] = []

    for (const filePath of getTypeScriptFiles(sharedRoot)) {
      const lines = readFileSync(filePath, 'utf-8').split('\n')
      for (let i = 0; i < lines.length; i++) {
        if (hasMainImport(lines[i])) {
          const relative = filePath.replace(ROOT + '/', '')
          violations.push(`${relative}:${i + 1}: ${lines[i].trim()}`)
        }
      }
    }

    expect(violations).toEqual([])
  })
})
