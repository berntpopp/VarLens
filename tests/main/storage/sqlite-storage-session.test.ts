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

  it('lists cases in descending created_at order from the database service', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'varlens-storage-session-'))
    const dbPath = join(tempDir, 'session.db')
    const db = new DatabaseService(dbPath)

    const olderCaseId = db.cases.createCase('older-case', '/older.vcf', 100)
    const newerCaseId = db.cases.createCase('newer-case', '/newer.vcf', 200)

    db.database.prepare('UPDATE cases SET created_at = ? WHERE id = ?').run(1_000, olderCaseId)
    db.database.prepare('UPDATE cases SET created_at = ? WHERE id = ?').run(2_000, newerCaseId)

    const session = new SqliteStorageSession({
      databaseService: db,
      dbPool: null
    })

    const cases = await session.listCases()

    expect(cases.map((entry) => entry.name)).toEqual(['newer-case', 'older-case'])

    await session.close()
  })

  it('uses the worker read pool for listCases when one is available', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'varlens-storage-session-'))
    const dbPath = join(tempDir, 'session.db')
    const db = new DatabaseService(dbPath)
    const pooledCases = [
      {
        id: 2,
        name: 'pooled-case',
        file_path: '/pooled.vcf',
        file_size: 512,
        variant_count: 4,
        created_at: 2_000,
        genome_build: 'GRCh38'
      }
    ]
    const dbPool = {
      run: async () => pooledCases,
      destroy: async () => undefined
    }

    const session = new SqliteStorageSession({
      databaseService: db,
      dbPool: dbPool as never
    })

    await expect(session.listCases()).resolves.toEqual(pooledCases)

    await session.close()
  })
})
