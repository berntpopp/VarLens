import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { DatabaseService } from '../../../src/main/database/DatabaseService'
import { SqliteStorageSession } from '../../../src/main/storage/sqlite/SqliteStorageSession'

let tempDir: string | null = null

afterEach(() => {
  if (tempDir !== null) {
    rmSync(tempDir, { recursive: true, force: true })
    tempDir = null
  }
})

describe('SqliteStorageSession', () => {
  it('exposes sqlite workspace metadata and compatibility getters', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'varlens-storage-session-'))
    const dbPath = join(tempDir, 'session.db')
    const db = new DatabaseService(dbPath)

    const session = new SqliteStorageSession({
      databaseService: db,
      dbPool: null
    })

    expect(session.workspace.kind).toBe('sqlite')
    expect(session.workspace.path).toBe(dbPath)
    expect(session.getDatabaseService()).toBe(db)
    expect(session.getDbPool()).toBeNull()
    expect(session.capabilities.backend).toBe('sqlite')
    expect(session.capabilities.supportsLocalFileLifecycle).toBe(true)

    await session.close()
  })

  it('returns a failed health result when the underlying database handle is closed', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'varlens-storage-session-'))
    const dbPath = join(tempDir, 'session.db')
    const db = new DatabaseService(dbPath)

    const session = new SqliteStorageSession({
      databaseService: db,
      dbPool: null
    })

    db.close()

    await expect(session.health()).resolves.toMatchObject({
      ok: false,
      backend: 'sqlite'
    })
  })
})
