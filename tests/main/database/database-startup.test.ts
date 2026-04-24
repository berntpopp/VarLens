import { describe, expect, it, vi } from 'vitest'

import type { StorageSession } from '../../../src/main/storage/session'
import type { PostgresStorageConfig } from '../../../src/main/storage/config'

describe('openConfiguredDatabase', () => {
  it('opens the default sqlite database when no experimental backend is requested', async () => {
    const manager = {
      open: vi.fn().mockResolvedValue(undefined),
      openPostgresSession: vi.fn().mockResolvedValue(undefined)
    }

    const { openConfiguredDatabase } = await import('../../../src/main/database/startup')

    await openConfiguredDatabase(manager as never, {
      env: {},
      userDataPath: '/tmp/varlens-user-data'
    })

    expect(manager.open).toHaveBeenCalledWith('/tmp/varlens-user-data/varlens.db')
    expect(manager.openPostgresSession).not.toHaveBeenCalled()
  })

  it('opens a postgres session when the experimental backend is explicitly requested', async () => {
    const manager = {
      open: vi.fn().mockResolvedValue(undefined),
      openPostgresSession: vi.fn().mockResolvedValue(undefined)
    }
    const config: PostgresStorageConfig = {
      url: 'postgres://varlens:secret@127.0.0.1:55432/varlens_dev',
      schema: 'public',
      applicationName: 'varlens-main',
      sslMode: 'disable',
      connectionTimeoutMillis: 5000,
      statementTimeoutMs: 30000,
      queryTimeoutMs: 30000,
      lockTimeoutMs: 5000,
      idleInTransactionSessionTimeoutMs: 10000,
      poolMax: 4
    }
    const pool = { end: vi.fn(), on: vi.fn(), query: vi.fn() }
    const session = {
      workspace: {
        kind: 'postgres',
        connectionLabel: '127.0.0.1:55432/varlens_dev (public)',
        connectionUrlRedacted: 'postgres://127.0.0.1:55432/varlens_dev',
        schema: 'public'
      },
      capabilities: {
        backend: 'postgres',
        supportsEncryptionAtRest: false,
        supportsLocalFileLifecycle: false,
        supportsHostedConnectionLifecycle: true,
        supportsWorkerReadPool: false,
        supportsFullTextSearch: false
      },
      listCases: async () => [],
      getDatabaseService: () => {
        throw new Error('not available')
      },
      getDbPool: () => {
        throw new Error('not available')
      },
      getEncryptionKey: () => undefined,
      needsStartupRebuild: () => false,
      rekey: () => {
        throw new Error('not available')
      },
      close: async () => undefined,
      health: async () => ({ ok: true, backend: 'postgres' as const })
    } satisfies StorageSession

    const { openConfiguredDatabase } = await import('../../../src/main/database/startup')

    await openConfiguredDatabase(manager as never, {
      env: {
        VARLENS_EXPERIMENTAL_STORAGE_BACKEND: 'postgres'
      },
      userDataPath: '/tmp/varlens-user-data',
      getPostgresConfig: () => config,
      createPostgresPool: vi.fn().mockReturnValue(pool),
      createPostgresSession: vi.fn().mockReturnValue(session)
    })

    expect(manager.open).not.toHaveBeenCalled()
    expect(manager.openPostgresSession).toHaveBeenCalledWith(session)
  })

  it('fails fast when postgres mode is requested without postgres config', async () => {
    const manager = {
      open: vi.fn().mockResolvedValue(undefined),
      openPostgresSession: vi.fn().mockResolvedValue(undefined)
    }

    const { openConfiguredDatabase } = await import('../../../src/main/database/startup')

    await expect(
      openConfiguredDatabase(manager as never, {
        env: {
          VARLENS_EXPERIMENTAL_STORAGE_BACKEND: 'postgres'
        },
        userDataPath: '/tmp/varlens-user-data',
        getPostgresConfig: () => null
      })
    ).rejects.toThrow('VARLENS_PG_URL')
  })

  it('closes the postgres session when handoff to DatabaseManager fails', async () => {
    const manager = {
      open: vi.fn().mockResolvedValue(undefined),
      openPostgresSession: vi.fn().mockRejectedValue(new Error('close failed'))
    }
    const config: PostgresStorageConfig = {
      url: 'postgres://varlens:secret@127.0.0.1:55432/varlens_dev',
      schema: 'public',
      applicationName: 'varlens-main',
      sslMode: 'disable',
      connectionTimeoutMillis: 5000,
      statementTimeoutMs: 30000,
      queryTimeoutMs: 30000,
      lockTimeoutMs: 5000,
      idleInTransactionSessionTimeoutMs: 10000,
      poolMax: 4
    }
    const pool = { end: vi.fn().mockResolvedValue(undefined), on: vi.fn(), query: vi.fn() }
    const session = {
      workspace: {
        kind: 'postgres',
        connectionLabel: '127.0.0.1:55432/varlens_dev (public)',
        connectionUrlRedacted: 'postgres://127.0.0.1:55432/varlens_dev',
        schema: 'public'
      },
      capabilities: {
        backend: 'postgres',
        supportsEncryptionAtRest: false,
        supportsLocalFileLifecycle: false,
        supportsHostedConnectionLifecycle: true,
        supportsWorkerReadPool: false,
        supportsFullTextSearch: false
      },
      listCases: async () => [],
      getDatabaseService: () => {
        throw new Error('not available')
      },
      getDbPool: () => {
        throw new Error('not available')
      },
      getEncryptionKey: () => undefined,
      needsStartupRebuild: () => false,
      rekey: () => {
        throw new Error('not available')
      },
      close: vi.fn().mockResolvedValue(undefined),
      health: async () => ({ ok: true, backend: 'postgres' as const })
    } satisfies StorageSession

    const { openConfiguredDatabase } = await import('../../../src/main/database/startup')

    await expect(
      openConfiguredDatabase(manager as never, {
        env: {
          VARLENS_EXPERIMENTAL_STORAGE_BACKEND: 'postgres'
        },
        userDataPath: '/tmp/varlens-user-data',
        getPostgresConfig: () => config,
        createPostgresPool: vi.fn().mockReturnValue(pool),
        createPostgresSession: vi.fn().mockReturnValue(session)
      })
    ).rejects.toThrow('close failed')

    expect(session.close).toHaveBeenCalledTimes(1)
    expect(pool.end).not.toHaveBeenCalled()
  })
})
