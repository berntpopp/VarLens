/**
 * Bundled HPO term list for the web server's `hpo:search`.
 *
 * The desktop renderer searches `src/renderer/src/assets/data/hpo-terms.json`
 * offline (useHpoBundled). The web server serves the same file so HPO term
 * search never sends a phenotype query off the server. Resolution order:
 *
 *   1. `VARLENS_HPO_TERMS_PATH`
 *   2. `<cwd>/resources/hpo-terms.json` (the Docker image copies it there)
 *   3. `<cwd>/src/renderer/src/assets/data/hpo-terms.json` (source checkout / tests)
 *
 * Loaded once on first use and kept in memory (~1.5 MB of JSON).
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import type { HpoTermEntry } from '../../shared/utils/hpo-term-search'

export const HPO_TERMS_PATH_ENV = 'VARLENS_HPO_TERMS_PATH'

let cache: { path: string; terms: HpoTermEntry[] } | null = null

export function resolveWebHpoTermsPath(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env[HPO_TERMS_PATH_ENV]
  if (explicit !== undefined && explicit.trim() !== '') return explicit.trim()

  const candidates = [
    resolve(process.cwd(), 'resources/hpo-terms.json'),
    resolve(process.cwd(), 'src/renderer/src/assets/data/hpo-terms.json')
  ]
  const found = candidates.find((candidate) => existsSync(candidate))
  if (found !== undefined) return found
  throw new Error(`HPO term list not found for web server. Checked: ${candidates.join(', ')}`)
}

function isTermEntry(value: unknown): value is HpoTermEntry {
  if (typeof value !== 'object' || value === null) return false
  const row = value as Record<string, unknown>
  return typeof row.id === 'string' && typeof row.name === 'string'
}

export function loadWebHpoTerms(): HpoTermEntry[] {
  const path = resolveWebHpoTermsPath()
  if (cache?.path === path) return cache.terms
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown
  if (!Array.isArray(parsed)) throw new Error(`HPO term list at ${path} is not an array`)
  const terms = parsed.filter(isTermEntry).map((row) => ({ id: row.id, name: row.name }))
  if (terms.length === 0) throw new Error(`HPO term list at ${path} is empty`)
  cache = { path, terms }
  return terms
}

/** Test hook: drop the in-memory term list. */
export function resetWebHpoTermsCache(): void {
  cache = null
}
