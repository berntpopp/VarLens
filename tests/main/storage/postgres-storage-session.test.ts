import { describe, expect, it, vi } from 'vitest'

import type { Case } from '../../../src/shared/types/database'
import type { PostgresStorageConfig } from '../../../src/main/storage/config'
import type { PostgresMigrationResult } from '../../../src/main/storage/postgres/migrations/types'
import {
  POSTGRES_CAPABILITIES,
  PostgresStorageSession
} from '../../../src/main/storage/postgres/PostgresStorageSession'

const postgresMocks = vi.hoisted(() => ({
  Pool: vi.fn(),
  PostgresMigrationRunner: vi.fn()
}))

vi.mock('pg', () => ({
  Pool: postgresMocks.Pool
}))

vi.mock('../../../src/main/storage/postgres/migrations/PostgresMigrationRunner', () => ({
  PostgresMigrationRunner: postgresMocks.PostgresMigrationRunner
}))

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
    expect(session.getWriteExecutor()).toBeDefined()
    expect(session.capabilities).toEqual(POSTGRES_CAPABILITIES)
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

  it('includes the session migration version in diagnostics', async () => {
    const migrationResult: PostgresMigrationResult = {
      beforeVersion: '006',
      applied: ['007'],
      currentVersion: '007',
      schema: 'workspace_a'
    }
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ version: 'PostgreSQL 16' }] })
        .mockResolvedValueOnce({ rows: [{ current_user: 'varlens_app' }] })
        .mockResolvedValueOnce({ rows: [{ relation: null }] })
        .mockResolvedValueOnce({ rows: [{ can_read_schema: true }] })
        .mockResolvedValueOnce({ rows: [{ can_write_schema: true }] }),
      end: vi.fn().mockResolvedValue(undefined),
      on: vi.fn()
    }

    const session = new PostgresStorageSession({
      config: makeConfig({ schema: 'workspace_a' }),
      pool: pool as never,
      migrationResult
    })

    await expect(session.collectDiagnostics()).resolves.toMatchObject({
      ok: true,
      schema: 'workspace_a',
      currentMigration: '007'
    })
  })

  it('rejects sqlite-only compatibility methods', async () => {
    const session = new PostgresStorageSession({
      config: makeConfig(),
      pool: {
        query: vi.fn(),
        end: vi.fn(),
        on: vi.fn()
      } as never
    })

    // getDatabaseService / getDbPool are off the StorageSession interface and
    // removed from PostgresStorageSession entirely. Only the SQLite-only method
    // that remains on the interface (rekey) is still asserted here.
    await expect(session.rekey('secret')).rejects.toThrow('SQLite rekey is not supported')
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
        params: [
          {
            limit: 25,
            offset: 0,
            sort_order: 'desc'
          }
        ]
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

  it('routes case metadata writes through the session-owned postgres write executor', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [{ case_id: '1', sex: 'female' }]
      }),
      end: vi.fn().mockResolvedValue(undefined),
      on: vi.fn()
    }
    const session = new PostgresStorageSession({
      config: makeConfig({ schema: 'phase6_metadata' }),
      pool: pool as never
    })

    await expect(
      session.getWriteExecutor().execute({
        type: 'case-metadata:upsert',
        params: [1, { sex: 'female' }]
      })
    ).resolves.toMatchObject({
      case_id: 1,
      sex: 'female'
    })

    expect(pool.query).toHaveBeenCalledTimes(1)
    expect(pool.query.mock.calls[0][0]).toContain('"phase6_metadata"."case_metadata"')
  })

  it('returns an import executor with the storage-import contract surface', () => {
    const session = new PostgresStorageSession({
      config: makeConfig(),
      pool: {
        query: vi.fn(),
        end: vi.fn(),
        on: vi.fn(),
        connect: vi.fn()
      } as never
    })
    const executor = session.getImportExecutor()
    expect(typeof executor.importSingleFile).toBe('function')
    expect(typeof executor.cancel).toBe('function')
  })

  it('routes variant small reads through the session-owned postgres read executor', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [{ variant_type: 'snv', count: '2' }]
      }),
      end: vi.fn().mockResolvedValue(undefined),
      on: vi.fn()
    }
    const session = new PostgresStorageSession({
      config: makeConfig({ schema: 'phase7_variants' }),
      pool: pool as never
    })

    await expect(
      session.getReadExecutor().execute({
        type: 'variants:typeCounts',
        params: [1]
      })
    ).resolves.toEqual({ snv: 2 })

    expect(pool.query).toHaveBeenCalledTimes(1)
    const typeCountsSpec = pool.query.mock.calls[0][0] as { text: string }
    expect(typeCountsSpec.text).toContain('"phase7_variants"."variants"')
  })

  it('routes cohort summary through the session-owned postgres read executor', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            total_cases: '2',
            total_variants: '6',
            unique_variants: '4',
            genes_with_variants: '3',
            starred_variants: '1',
            pathogenic: '1',
            likely_pathogenic: '0',
            vus: '2',
            likely_benign: '0',
            benign: '1'
          }
        ]
      }),
      end: vi.fn().mockResolvedValue(undefined),
      on: vi.fn()
    }
    const session = new PostgresStorageSession({
      config: makeConfig({ schema: 'phase8_cohort' }),
      pool: pool as never
    })

    await expect(
      session.getReadExecutor().execute({
        type: 'cohort:summary',
        params: []
      })
    ).resolves.toMatchObject({
      total_cases: 2,
      total_variants: 6,
      unique_variants: 4,
      avg_variants_per_case: 3,
      genes_with_variants: 3,
      starred_variants: 1,
      acmg_counts: {
        pathogenic: 1,
        vus: 2,
        benign: 1
      }
    })

    expect(pool.query).toHaveBeenCalledTimes(1)
    expect(pool.query.mock.calls[0][0]).toContain('"phase8_cohort"."cases"')
    expect(pool.query.mock.calls[0][0]).toContain('"phase8_cohort"."variants"')
  })

  it('routes audit reads and writes through session-owned postgres executors', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [
            {
              id: '1',
              action_type: 'star',
              entity_type: 'variant_annotation',
              entity_key: '1:100:A:G',
              old_value: null,
              new_value: '{}',
              created_at: '1234'
            }
          ]
        })
        .mockResolvedValueOnce({ rows: [] }),
      end: vi.fn().mockResolvedValue(undefined),
      on: vi.fn()
    }
    const session = new PostgresStorageSession({
      config: makeConfig({ schema: 'phase9_audit' }),
      pool: pool as never
    })

    await expect(
      session.getReadExecutor().execute({
        type: 'audit:getByEntity',
        params: ['1:100:A:G']
      })
    ).resolves.toMatchObject([{ entity_key: '1:100:A:G', timestamp: 1234 }])
    await expect(
      session.getWriteExecutor().execute({
        type: 'audit:append',
        params: [
          {
            action_type: 'star',
            entity_type: 'variant_annotation',
            entity_key: '1:100:A:G',
            old_value: null,
            new_value: '{}'
          }
        ]
      })
    ).resolves.toBeUndefined()

    expect(pool.query.mock.calls[0][0]).toContain('varlens_audit."audit_log"')
    expect(pool.query.mock.calls[0][1]).toContain('phase9_audit')
    expect(pool.query.mock.calls[1][0]).toContain('varlens_audit."audit_log"')
    expect(pool.query.mock.calls[1][1]).toContain('phase9_audit')
  })
})

describe('createPostgresStorageSession', () => {
  it('runs migrations before exposing the session', async () => {
    const events: string[] = []
    const pool = {
      connect: vi.fn(),
      query: vi.fn(),
      end: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(() => {
        events.push('session')
      })
    }
    const migrationResult: PostgresMigrationResult = {
      beforeVersion: null,
      applied: ['001'],
      currentVersion: '001',
      schema: 'workspace_a'
    }
    postgresMocks.Pool.mockImplementation(function Pool() {
      return pool
    })
    postgresMocks.PostgresMigrationRunner.mockImplementation(function PostgresMigrationRunner() {
      return {
        migrate: vi.fn(async () => {
          events.push('migrate')
          return migrationResult
        })
      }
    })

    const { createPostgresStorageSession } =
      await import('../../../src/main/storage/postgres/createPostgresStorageSession')

    const session = await createPostgresStorageSession(makeConfig({ schema: 'workspace_a' }))

    expect(events).toEqual(['migrate', 'session'])
    await expect(session.collectDiagnostics()).resolves.toMatchObject({
      currentMigration: '001'
    })
  })

  it('closes the pool when migration fails', async () => {
    const pool = {
      connect: vi.fn(),
      query: vi.fn(),
      end: vi.fn().mockResolvedValue(undefined),
      on: vi.fn()
    }
    postgresMocks.Pool.mockImplementation(function Pool() {
      return pool
    })
    postgresMocks.PostgresMigrationRunner.mockImplementation(function PostgresMigrationRunner() {
      return {
        migrate: vi.fn().mockRejectedValue(new Error('migration failed'))
      }
    })

    const { createPostgresStorageSession } =
      await import('../../../src/main/storage/postgres/createPostgresStorageSession')

    await expect(createPostgresStorageSession(makeConfig())).rejects.toThrow('migration failed')
    expect(pool.end).toHaveBeenCalledOnce()
  })

  it('preserves the migration error when cleanup also fails', async () => {
    const migrationError = new Error('migration failed')
    const cleanupError = new Error('cleanup failed')
    const pool = {
      connect: vi.fn(),
      query: vi.fn(),
      end: vi.fn().mockRejectedValue(cleanupError),
      on: vi.fn()
    }
    postgresMocks.Pool.mockImplementation(function Pool() {
      return pool
    })
    postgresMocks.PostgresMigrationRunner.mockImplementation(function PostgresMigrationRunner() {
      return {
        migrate: vi.fn().mockRejectedValue(migrationError)
      }
    })

    const { createPostgresStorageSession } =
      await import('../../../src/main/storage/postgres/createPostgresStorageSession')

    await expect(createPostgresStorageSession(makeConfig())).rejects.toThrow('migration failed')
    expect((migrationError as Error & { cleanupError?: unknown }).cleanupError).toBe(cleanupError)
    expect(pool.end).toHaveBeenCalledOnce()
  })
})
