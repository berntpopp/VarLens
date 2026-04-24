import { describe, expect, it, vi } from 'vitest'

import type { Case } from '../../../src/shared/types/database'
import type { PostgresStorageConfig } from '../../../src/main/storage/config'
import { PostgresStorageSession } from '../../../src/main/storage/postgres/PostgresStorageSession'

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

describe('PostgresStorageSession', () => {
  it('exposes redacted workspace metadata and explicit postgres capabilities', () => {
    const pool = {
      query: vi.fn(),
      end: vi.fn(),
      on: vi.fn()
    }

    const session = new PostgresStorageSession({
      config: makeConfig(),
      pool: pool as never
    })

    expect(pool.on).toHaveBeenCalledWith('error', expect.any(Function))
    expect(session.workspace.kind).toBe('postgres')
    expect(session.workspace.connectionUrlRedacted).toBe('postgres://127.0.0.1:55432/varlens_dev')
    expect(session.workspace.connectionLabel).toBe('127.0.0.1:55432/varlens_dev (public)')
    expect(session.getReadExecutor()).toBeDefined()
    expect(session.capabilities).toEqual({
      backend: 'postgres',
      supportsEncryptionAtRest: false,
      supportsLocalFileLifecycle: false,
      supportsHostedConnectionLifecycle: true,
      supportsWorkerReadPool: false,
      supportsFileBackedWorkerWrites: false,
      supportsFullTextSearch: false
    })
  })

  it('returns a healthy result when the round-trip query succeeds', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] }),
      end: vi.fn().mockResolvedValue(undefined),
      on: vi.fn()
    }

    const session = new PostgresStorageSession({
      config: makeConfig(),
      pool: pool as never
    })

    await expect(session.health()).resolves.toMatchObject({
      ok: true,
      backend: 'postgres'
    })
    expect(pool.query).toHaveBeenCalledWith('SELECT 1')
  })

  it('returns a failed health result when the round-trip query fails', async () => {
    const session = new PostgresStorageSession({
      config: makeConfig(),
      pool: {
        query: vi.fn().mockRejectedValue(new Error('connection refused')),
        end: vi.fn().mockResolvedValue(undefined),
        on: vi.fn()
      } as never
    })

    await expect(session.health()).resolves.toMatchObject({
      ok: false,
      backend: 'postgres',
      message: 'connection refused'
    })
  })

  it('throws for sqlite-only compatibility methods', () => {
    const session = new PostgresStorageSession({
      config: makeConfig(),
      pool: {
        query: vi.fn(),
        end: vi.fn(),
        on: vi.fn()
      } as never
    })

    expect(() => session.getDatabaseService()).toThrow('DatabaseService is not available')
    expect(() => session.getDbPool()).toThrow('DbPool is not available')
    expect(() => session.rekey('secret')).toThrow('SQLite rekey is not supported')
  })

  it('closes the underlying pool', async () => {
    const pool = {
      query: vi.fn(),
      end: vi.fn().mockResolvedValue(undefined),
      on: vi.fn()
    }

    const session = new PostgresStorageSession({
      config: makeConfig(),
      pool: pool as never
    })

    await session.close()
    expect(pool.end).toHaveBeenCalledTimes(1)
  })

  it('delegates listCases to a repository created from the pool and schema', async () => {
    const pool = {
      query: vi.fn(),
      end: vi.fn().mockResolvedValue(undefined),
      on: vi.fn()
    }
    const expectedCases: Case[] = [
      {
        id: 1,
        name: 'postgres-case',
        file_path: '/postgres.vcf',
        file_size: 1024,
        variant_count: 2,
        created_at: 1_000,
        genome_build: 'GRCh38'
      }
    ]
    const repository = {
      listCases: vi.fn().mockResolvedValue(expectedCases)
    }
    const createCaseListRepository = vi.fn().mockReturnValue(repository)

    const session = new PostgresStorageSession({
      config: makeConfig({ schema: 'varlens_app' }),
      pool: pool as never,
      createCaseListRepository
    })

    await expect(session.listCases()).resolves.toEqual(expectedCases)
    expect(createCaseListRepository).toHaveBeenCalledWith(pool, 'varlens_app')
    expect(repository.listCases).toHaveBeenCalledTimes(1)
  })

  it('routes cases:query through the session-owned postgres read executor', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [
            {
              id: '1',
              name: 'postgres-case',
              file_path: '/postgres.vcf',
              file_size: '1024',
              variant_count: '2',
              created_at: '1000',
              genome_build: 'GRCh38',
              affected_status: null,
              sex: null,
              cohort_names: [],
              cohort_ids: []
            }
          ]
        })
        .mockResolvedValueOnce({ rows: [{ total_count: 1 }] }),
      end: vi.fn().mockResolvedValue(undefined),
      on: vi.fn()
    }
    const session = new PostgresStorageSession({
      config: makeConfig({ schema: 'phase4_cases' }),
      pool: pool as never
    })

    await expect(
      session.getReadExecutor().execute({
        type: 'cases:query',
        params: {
          limit: 25,
          offset: 0,
          sort_order: 'desc'
        }
      })
    ).resolves.toMatchObject({
      data: [
        {
          name: 'postgres-case'
        }
      ],
      total_count: 1
    })
  })

  it('routes cases:availableBuilds through the session-owned postgres read executor', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [{ build: 'GRCh38', case_count: 2 }]
      }),
      end: vi.fn().mockResolvedValue(undefined),
      on: vi.fn()
    }
    const session = new PostgresStorageSession({
      config: makeConfig({ schema: 'phase5_cases' }),
      pool: pool as never
    })

    await expect(
      session.getReadExecutor().execute({
        type: 'cases:availableBuilds',
        params: []
      })
    ).resolves.toEqual([{ build: 'GRCh38', caseCount: 2 }])

    expect(pool.query).toHaveBeenCalledTimes(1)
    expect(pool.query.mock.calls[0][0]).toContain('"phase5_cases"."cases"')
  })
})
