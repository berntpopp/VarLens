/**
 * `vep:fetch` keeps working after the database is switched (#488): the
 * response cache must follow the current connection, not the first one.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import Database from 'better-sqlite3-multiple-ciphers'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  net: { isOnline: () => true }
}))

import { ipcMain } from 'electron'
import { registerVepHandlers } from '../../../../src/main/ipc/handlers/vep'
import type { HandlerDependencies } from '../../../../src/main/ipc/types'

type HandlerCallback = (event: unknown, ...args: unknown[]) => Promise<unknown>

function openCacheDb(): Database.Database {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE api_cache (
      cache_key TEXT PRIMARY KEY,
      response_data TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    )
  `)
  return db
}

function cachedVepRows(db: Database.Database): number {
  return db
    .prepare("SELECT COUNT(*) FROM api_cache WHERE cache_key LIKE 'vep:%'")
    .pluck()
    .get() as number
}

describe('vep:fetch after a database switch', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reads and writes the cache on the current connection', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify([{ input: 'x' }]), { status: 200 }))
    )
    const first = openCacheDb()
    const second = openCacheDb()
    let current = first
    registerVepHandlers({
      ipcMain,
      getDb: () => ({ database: current })
    } as unknown as HandlerDependencies)
    const fetchVep = vi
      .mocked(ipcMain.handle)
      .mock.calls.find(([channel]) => channel === 'vep:fetch')?.[1] as HandlerCallback

    expect(await fetchVep({}, '1', 100, 'A', 'T')).toMatchObject({ success: true })
    expect(cachedVepRows(first)).toBe(1)

    first.close()
    current = second

    expect(await fetchVep({}, '1', 200, 'A', 'T')).toMatchObject({ success: true })
    expect(cachedVepRows(second)).toBe(1)
    second.close()
  })
})
