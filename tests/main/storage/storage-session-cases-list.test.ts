import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { DatabaseService } from '../../../src/main/database/DatabaseService'
import type { Case } from '../../../src/shared/types/database'
import type { PostgresStorageConfig } from '../../../src/main/storage/config'
import { PostgresStorageSession } from '../../../src/main/storage/postgres/PostgresStorageSession'
import { SqliteStorageSession } from '../../../src/main/storage/sqlite/SqliteStorageSession'

let tempDir: string | null = null

function makeConfig(overrides: Partial<PostgresStorageConfig> = {}): PostgresStorageConfig {
  return {
    url: 'postgres://varlens:secret@127.0.0.1:55432/varlens_dev',
    schema: 'public',
    applicationName: 'varlens-main',
    sslMode: 'disable',
    connectionTimeoutMillis: 5000,
    statementTimeoutMs: 30000,
    queryTimeoutMs: 30000,
    lockTimeoutMs: 5000,
    idleInTransactionSessionTimeoutMs: 10000,
    poolMax: 4,
    ...overrides
  }
}

afterEach(() => {
  if (tempDir !== null) {
    rmSync(tempDir, { recursive: true, force: true })
    tempDir = null
  }
})

describe('StorageSession listCases contract', () => {
  it('returns SQLite cases in the shared Case shape', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'varlens-storage-session-'))
    const dbPath = join(tempDir, 'session.db')
    const db = new DatabaseService(dbPath)
    const caseId = db.cases.createCase('sqlite-case', '/sqlite.vcf', 123)

    const session = new SqliteStorageSession({
      databaseService: db,
      dbPool: null
    })

    const cases = await session.listCases()

    expect(cases).toHaveLength(1)
    expect(cases[0]).toMatchObject({
      id: caseId,
      name: 'sqlite-case',
      file_path: '/sqlite.vcf',
      file_size: 123,
      variant_count: 0,
      created_at: expect.any(Number),
      genome_build: 'GRCh38'
    })

    await session.close()
  })

  it('returns PostgreSQL cases in the shared Case shape', async () => {
    const expectedCases: Case[] = [
      {
        id: 7,
        name: 'postgres-case',
        file_path: '/postgres.vcf',
        file_size: 456,
        variant_count: 8,
        created_at: 3_000,
        genome_build: 'GRCh38'
      }
    ]
    const pool = {
      query: vi.fn(),
      end: vi.fn().mockResolvedValue(undefined),
      on: vi.fn()
    }
    const repository = {
      listCases: vi.fn().mockResolvedValue(expectedCases)
    }

    const session = new PostgresStorageSession({
      config: makeConfig(),
      pool: pool as never,
      createCaseListRepository: vi.fn().mockReturnValue(repository)
    })

    await expect(session.listCases()).resolves.toEqual(expectedCases)
  })
})
