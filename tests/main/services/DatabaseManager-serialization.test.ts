/**
 * #561: overlapping open/switch/close calls run one at a time, so no session
 * is leaked, closed twice, or resurrected after it was closed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { StorageSession } from '../../../src/main/storage/session'

interface FakeSession {
  path: string
  close: ReturnType<typeof vi.fn>
  closed: boolean
}

const state = vi.hoisted(() => ({
  pending: new Map<
    string,
    { resolve: (s: unknown) => void; reject: (e: Error) => void; promise: Promise<unknown> }
  >()
}))

vi.mock('../../../src/main/database/migrate-off-thread', () => ({
  migrateSqliteOffThread: async () => ({})
}))

vi.mock('../../../src/main/storage/sqlite/createSqliteStorageSession', () => ({
  createSqliteStorageSession: (path: string) => deferredFor(path).promise
}))

function deferredFor(path: string) {
  let entry = state.pending.get(path)
  if (entry === undefined) {
    let resolve!: (s: unknown) => void
    let reject!: (e: Error) => void
    const promise = new Promise<unknown>((res, rej) => {
      resolve = res
      reject = rej
    })
    entry = { resolve, reject, promise }
    state.pending.set(path, entry)
  }
  return entry
}

function fakeSession(path: string): FakeSession {
  const session: FakeSession = {
    path,
    closed: false,
    close: vi.fn(async () => {
      session.closed = true
    })
  }
  return Object.assign(session, {
    workspace: { kind: 'sqlite', path, name: path, encrypted: false },
    capabilities: { backend: 'sqlite' }
  })
}

import { DatabaseManager } from '../../../src/main/services/DatabaseManager'
import type { RecentDatabasesService } from '../../../src/main/services/RecentDatabasesService'

const recent = { addRecent: vi.fn() } as unknown as RecentDatabasesService

async function managerWithA(): Promise<{ manager: DatabaseManager; a: FakeSession }> {
  const manager = new DatabaseManager(recent)
  const a = fakeSession('a.db')
  deferredFor('a.db').resolve(a)
  await manager.open('a.db')
  return { manager, a }
}

function current(manager: DatabaseManager): FakeSession | null {
  return manager.getCurrentSessionOrNull() as unknown as FakeSession | null
}

describe('DatabaseManager lifecycle serialization (#561)', () => {
  beforeEach(() => {
    state.pending.clear()
  })

  it('overlapping switches resolved in reverse order close every displaced session once', async () => {
    const { manager, a } = await managerWithA()
    const b = fakeSession('b.db')
    const c = fakeSession('c.db')

    const toB = manager.switchDatabase('b.db')
    const toC = manager.switchDatabase('c.db')
    deferredFor('c.db').resolve(c)
    deferredFor('b.db').resolve(b)
    await Promise.all([toB, toC])

    expect(a.close).toHaveBeenCalledTimes(1)
    expect(b.close).toHaveBeenCalledTimes(1)
    expect(c.close).not.toHaveBeenCalled()
    expect(current(manager)).toBe(c)
  })

  it('a failing second switch keeps the first switch open and never restores a closed session', async () => {
    const { manager, a } = await managerWithA()
    const b = fakeSession('b.db')

    const toB = manager.switchDatabase('b.db')
    const toC = manager.switchDatabase('c.db')
    deferredFor('c.db').reject(new Error('migration failed'))
    deferredFor('b.db').resolve(b)

    await expect(toB).resolves.toBeUndefined()
    await expect(toC).rejects.toThrow(/Failed to switch/)
    expect(a.close).toHaveBeenCalledTimes(1)
    expect(b.close).not.toHaveBeenCalled()
    expect(current(manager)).toBe(b)
    expect(b.closed).toBe(false)
  })

  it('close during an open closes the opened session after the open completes', async () => {
    const { manager, a } = await managerWithA()
    const b = fakeSession('b.db')

    const openB = manager.open('b.db')
    const closing = manager.close()
    deferredFor('b.db').resolve(b)
    await Promise.all([openB, closing])

    expect(a.close).toHaveBeenCalledTimes(1)
    expect(b.close).toHaveBeenCalledTimes(1)
    expect(current(manager)).toBeNull()
  })

  it('recovers the queue after a rejected step', async () => {
    const { manager } = await managerWithA()
    deferredFor('bad.db').reject(new Error('boom'))
    await expect(manager.switchDatabase('bad.db')).rejects.toThrow()

    const d = fakeSession('d.db')
    deferredFor('d.db').resolve(d)
    await manager.createDatabase('d.db')
    expect(current(manager)).toBe(d)
  })

  it('openPostgresSession waits for a pending switch and closes it once', async () => {
    const { manager, a } = await managerWithA()
    const b = fakeSession('b.db')
    const pg = {
      workspace: { kind: 'postgres' },
      capabilities: { backend: 'postgres' },
      close: vi.fn()
    } as unknown as StorageSession

    const toB = manager.switchDatabase('b.db')
    const toPg = manager.openPostgresSession(pg)
    deferredFor('b.db').resolve(b)
    await Promise.all([toB, toPg])

    expect(a.close).toHaveBeenCalledTimes(1)
    expect(b.close).toHaveBeenCalledTimes(1)
    expect(manager.getCurrentSessionOrNull()).toBe(pg)
  })
})
