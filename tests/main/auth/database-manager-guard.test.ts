/**
 * The open guard's seam in DatabaseManager (#295): without a guard an open
 * failure is wrapped as before, whatever error class it has; with one, an
 * AppError keeps its own code and message, so a refusal says why.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const opening = vi.hoisted(() => ({ failure: undefined as unknown }))
vi.mock('../../../src/main/database/migrate-off-thread', () => ({
  migrateSqliteOffThread: async () => ({})
}))
vi.mock('../../../src/main/storage/sqlite/createSqliteStorageSession', () => ({
  createSqliteStorageSession: () => {
    throw opening.failure
  }
}))

import { DatabaseError } from '../../../src/main/database/errors'
import { ConflictError } from '../../../src/main/ipc/errors'
import { DatabaseManager } from '../../../src/main/services/DatabaseManager'
import { RecentDatabasesService } from '../../../src/main/services/RecentDatabasesService'

describe('DatabaseManager open errors', () => {
  let dir: string
  let manager: DatabaseManager

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'varlens-guard-seam-'))
    manager = new DatabaseManager(new RecentDatabasesService(join(dir, 'settings.json')))
    opening.failure = new ConflictError('The database is busy.')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('wraps every failure without a guard, an AppError included', async () => {
    const path = join(dir, 'a.db')
    await expect(manager.open(path)).rejects.toBeInstanceOf(DatabaseError)
    await expect(manager.switchDatabase(path)).rejects.toBeInstanceOf(DatabaseError)
    await expect(manager.createDatabase(path)).rejects.toBeInstanceOf(DatabaseError)
  })

  it('lets an AppError through once a guard is installed', async () => {
    manager.setOpenGuard({ checkKey: () => undefined, checkSession: async () => undefined })
    const path = join(dir, 'a.db')
    await expect(manager.open(path)).rejects.toBe(opening.failure)
    await expect(manager.switchDatabase(path)).rejects.toBe(opening.failure)
    await expect(manager.createDatabase(path)).rejects.toBe(opening.failure)
    opening.failure = new Error('disk full')
    await expect(manager.open(path)).rejects.toBeInstanceOf(DatabaseError)
  })
})
