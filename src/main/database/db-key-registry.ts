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
  if (!isRecord(registry.keys) || !isRecord(registry.pathIndex)) return false

  for (const [keyId, entry] of Object.entries(registry.keys)) {
    if (keyId === '' || !isValidKeyEntry(entry)) return false
  }

  for (const [dbPath, keyId] of Object.entries(registry.pathIndex)) {
    if (dbPath === '' || typeof keyId !== 'string') return false
    const entry = registry.keys[keyId]
    if (!isValidKeyEntry(entry) || entry.path !== dbPath) return false
  }

  return true
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isValidKeyEntry(value: unknown): value is KeyEntry {
  if (!isRecord(value) || typeof value.path !== 'string' || value.path === '') return false
  if (value.state !== undefined && value.state !== 'pending' && value.state !== 'active') {
    return false
  }
  if (value.safeWrap !== undefined && typeof value.safeWrap !== 'string') return false
  if (value.passWrap !== undefined && !isValidPassphraseWrap(value.passWrap)) return false
  return value.safeWrap !== undefined || value.passWrap !== undefined
}

function isValidPassphraseWrap(value: unknown): value is PassphraseWrap {
  return (
    isRecord(value) &&
    typeof value.saltB64 === 'string' &&
    typeof value.ivB64 === 'string' &&
    typeof value.ctB64 === 'string' &&
    typeof value.tagB64 === 'string'
  )
}
