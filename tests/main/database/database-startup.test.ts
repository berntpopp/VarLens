import { describe, expect, it, vi } from 'vitest'

import type { StorageSession } from '../../../src/main/storage/session'
import type { PostgresStorageConfig } from '../../../src/main/storage/config'
import { POSTGRES_CAPABILITIES } from '../../../src/main/storage/postgres/PostgresStorageSession'

describe('openConfiguredDatabase', () => {
  it('does not load postgres migration definitions for the default sqlite database', async () => {
    vi.resetModules()
    vi.doMock('../../../src/main/storage/postgres/migrations/definitions', () => {
      throw new Error('postgres migrations should not load for sqlite startup')
    })

    try {
      const manager = {
        open: vi.fn().mockResolvedValue(undefined),
        openPostgresSession: vi.fn().mockResolvedValue(undefined)
      }

      const { openConfiguredDatabase } = await import('../../../src/main/database/startup')

      await openConfiguredDatabase(manager as never, {
        env: {},
        userDataPath: '/tmp/varlens-user-data',
        fileExists: () => true
      })

      expect(manager.open).toHaveBeenCalledWith('/tmp/varlens-user-data/varlens.db')
      expect(manager.openPostgresSession).not.toHaveBeenCalled()
    } finally {
      vi.doUnmock('../../../src/main/storage/postgres/migrations/definitions')
      vi.resetModules()
    }
  })

  it('opens the default sqlite database when no experimental backend is requested and it already exists', async () => {
    const manager = {
      open: vi.fn().mockResolvedValue(undefined),
      openPostgresSession: vi.fn().mockResolvedValue(undefined)
    }

    const { openConfiguredDatabase } = await import('../../../src/main/database/startup')

    await openConfiguredDatabase(manager as never, {
      env: {},
      userDataPath: '/tmp/varlens-user-data',
      fileExists: () => true
    })

    expect(manager.open).toHaveBeenCalledWith('/tmp/varlens-user-data/varlens.db')
    expect(manager.openPostgresSession).not.toHaveBeenCalled()
  })

  it('creates the default sqlite database encrypted by default via a managed key when it does not exist yet', async () => {
    const manager = {
      open: vi.fn().mockResolvedValue(undefined),
      createDatabase: vi.fn().mockResolvedValue(undefined),
      openPostgresSession: vi.fn().mockResolvedValue(undefined)
    }
    const keyStore = {
      createManagedKey: vi.fn().mockReturnValue({ ok: true, keyId: 'k1', dek: 'the-dek' }),
      wrapNewDekWithPassphrase: vi.fn(),
      resolveKeyForPath: vi.fn(),
      resolveKeyWithPassphrase: vi.fn()
    }

    const { openConfiguredDatabase } = await import('../../../src/main/database/startup')

    await openConfiguredDatabase(manager as never, {
      env: {},
      userDataPath: '/tmp/varlens-user-data',
      fileExists: () => false,
      keyStore
    })

    expect(keyStore.createManagedKey).toHaveBeenCalledWith('/tmp/varlens-user-data/varlens.db')
    expect(manager.createDatabase).toHaveBeenCalledWith(
      '/tmp/varlens-user-data/varlens.db',
      'the-dek'
    )
    expect(manager.open).not.toHaveBeenCalled()
  })

  it('falls back to an unencrypted default database (with a warning) when the key-store cannot mint a managed key pre-window', async () => {
    const manager = {
      open: vi.fn().mockResolvedValue(undefined),
      createDatabase: vi.fn().mockResolvedValue(undefined),
      openPostgresSession: vi.fn().mockResolvedValue(undefined)
    }
    const keyStore = {
      createManagedKey: vi.fn().mockReturnValue({ ok: false, reason: 'safe-storage-unavailable' }),
      wrapNewDekWithPassphrase: vi.fn(),
      resolveKeyForPath: vi.fn(),
      resolveKeyWithPassphrase: vi.fn()
    }

    const { openConfiguredDatabase } = await import('../../../src/main/database/startup')
    // Fetched via the same dynamic import so the spy targets the exact
    // `mainLogger` module instance `startup.ts` resolved -- a prior test's
    // `vi.resetModules()` can otherwise leave a statically-imported binding
    // pointing at a stale module instance.
    const { mainLogger: startupMainLogger } = await import('../../../src/main/services/MainLogger')
    const warnSpy = vi.spyOn(startupMainLogger, 'warn').mockImplementation(() => undefined)

    try {
      await openConfiguredDatabase(manager as never, {
        env: {},
        userDataPath: '/tmp/varlens-user-data',
        fileExists: () => false,
        keyStore
      })

      expect(manager.createDatabase).toHaveBeenCalledWith('/tmp/varlens-user-data/varlens.db')
      expect(warnSpy).toHaveBeenCalledOnce()
      expect(warnSpy.mock.calls[0]?.[0]).toContain('safe-storage-unavailable')
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('resolves an existing encrypted default database transparently via the key-store on a later launch', async () => {
    const manager = {
      open: vi.fn().mockResolvedValue(undefined),
      openPostgresSession: vi.fn().mockResolvedValue(undefined)
    }
    const keyStore = {
      createManagedKey: vi.fn(),
      wrapNewDekWithPassphrase: vi.fn(),
      resolveKeyForPath: vi.fn().mockReturnValue({ ok: true, dek: 'the-dek' }),
      resolveKeyWithPassphrase: vi.fn()
    }

    const { openConfiguredDatabase } = await import('../../../src/main/database/startup')

    await openConfiguredDatabase(manager as never, {
      env: {},
      userDataPath: '/tmp/varlens-user-data',
      fileExists: () => true,
      keyStore
    })

    expect(keyStore.resolveKeyForPath).toHaveBeenCalledWith('/tmp/varlens-user-data/varlens.db')
    expect(manager.open).toHaveBeenCalledWith('/tmp/varlens-user-data/varlens.db', 'the-dek')
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
    const client = { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() }
    const pool = {
      end: vi.fn(),
      on: vi.fn(),
      query: vi.fn().mockResolvedValue({ rows: [] }),
      connect: vi.fn().mockResolvedValue(client)
    }
    const session = {
      workspace: {
        kind: 'postgres',
        connectionLabel: '127.0.0.1:55432/varlens_dev (public)',
        connectionUrlRedacted: 'postgres://127.0.0.1:55432/varlens_dev',
        schema: 'public'
      },
      capabilities: POSTGRES_CAPABILITIES,
      listCases: async () => [],
      getReadExecutor: () => ({
        execute: async () => {
          throw new Error('not available')
        }
      }),
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
    const client = { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() }
    const pool = {
      end: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
      query: vi.fn().mockResolvedValue({ rows: [] }),
      connect: vi.fn().mockResolvedValue(client)
    }
    const session = {
      workspace: {
        kind: 'postgres',
        connectionLabel: '127.0.0.1:55432/varlens_dev (public)',
        connectionUrlRedacted: 'postgres://127.0.0.1:55432/varlens_dev',
        schema: 'public'
      },
      capabilities: POSTGRES_CAPABILITIES,
      listCases: async () => [],
      getReadExecutor: () => ({
        execute: async () => {
          throw new Error('not available')
        }
      }),
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
