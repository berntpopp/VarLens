import type { PassphraseWrap } from './db-key-passphrase'

/** One on-disk registry entry and its wrapping state. */
export interface KeyEntry {
  path: string
  /** Missing means active for registries created before migration journaling. */
  state?: 'pending' | 'active'
  safeWrap?: string
  passWrap?: PassphraseWrap
}

export interface KeyRegistry {
  keys: Record<string, KeyEntry | undefined>
  pathIndex: Record<string, string | undefined>
}

export function emptyKeyRegistry(): KeyRegistry {
  return { keys: {}, pathIndex: {} }
}

export function isValidKeyRegistryShape(value: unknown): value is KeyRegistry {
  if (value === null || typeof value !== 'object') return false
  const registry = value as { keys?: unknown; pathIndex?: unknown }
  return (
    typeof registry.keys === 'object' &&
    registry.keys !== null &&
    !Array.isArray(registry.keys) &&
    typeof registry.pathIndex === 'object' &&
    registry.pathIndex !== null &&
    !Array.isArray(registry.pathIndex)
  )
}
