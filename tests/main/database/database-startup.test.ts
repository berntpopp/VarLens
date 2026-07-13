import { describe, expect, it, vi } from 'vitest'

import type { StorageSession } from '../../../src/main/storage/session'
import type { PostgresStorageConfig } from '../../../src/main/storage/config'
import { POSTGRES_CAPABILITIES } from '../../../src/main/storage/postgres/PostgresStorageSession'

describe('openConfiguredDatabase', () => {
  it('reconciles an abandoned pending migration after verified plaintext detection', async () => {
    const manager = {
      open: vi.fn().mockResolvedValue(undefined),
      openDetectEncryption: vi.fn().mockReturnValue({ needsPassword: false }),
      openPostgresSession: vi.fn()
    }
    const keyStore = {
      createManagedKey: vi.fn(),
      wrapNewDekWithPassphrase: vi.fn(),
      resolveKeyForPath: vi.fn(),
      resolveKeyWithPassphrase: vi.fn(),
      removeKey: vi.fn(),
      getKeyStateForPath: vi.fn().mockReturnValue('pending'),
      getKeyIdForPath: vi.fn().mockReturnValue('pending-key'),
      activateKey: vi.fn()
    }
    const { openConfiguredDatabase } = await import('../../../src/main/database/startup')

    await openConfiguredDatabase(manager as never, {
      env: {},
      userDataPath: '/tmp/varlens-user-data',
      fileExists: () => true,
      keyStore
    })

    expect(manager.open).toHaveBeenCalledWith('/tmp/varlens-user-data/varlens.db')
    expect(keyStore.removeKey).toHaveBeenCalledWith('pending-key')
    expect(keyStore.activateKey).not.toHaveBeenCalled()
  })

  it('activates a pending migration after the encrypted default accepts its managed DEK', async () => {
    const manager = {
      open: vi.fn().mockResolvedValue(undefined),
      openDetectEncryption: vi.fn().mockReturnValue({ needsPassword: true }),
      openPostgresSession: vi.fn()
    }
    const keyStore = {
      createManagedKey: vi.fn(),
      wrapNewDekWithPassphrase: vi.fn(),
      resolveKeyForPath: vi.fn().mockReturnValue({ ok: true, dek: 'pending-dek' }),
      resolveKeyWithPassphrase: vi.fn(),
      removeKey: vi.fn(),
      getKeyStateForPath: vi.fn().mockReturnValue('pending'),
      getKeyIdForPath: vi.fn().mockReturnValue('pending-key'),
      activateKey: vi.fn()
    }
    const { openConfiguredDatabase } = await import('../../../src/main/database/startup')

    await openConfiguredDatabase(manager as never, {
      env: {},
      userDataPath: '/tmp/varlens-user-data',
      fileExists: () => true,
      keyStore
    })

    expect(manager.open).toHaveBeenCalledWith('/tmp/varlens-user-data/varlens.db', 'pending-dek')
    expect(keyStore.activateKey).toHaveBeenCalledWith('pending-key')
  })
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
      createPendingManagedKey: vi
        .fn()
        .mockReturnValue({ ok: true, keyId: 'pending-k1', dek: 'the-dek' }),
      wrapNewDekWithPassphrase: vi.fn(),
      resolveKeyForPath: vi.fn(),
      resolveKeyWithPassphrase: vi.fn(),
      removeKey: vi.fn(),
      activateKey: vi.fn()
    }

    const { openConfiguredDatabase } = await import('../../../src/main/database/startup')

    await openConfiguredDatabase(manager as never, {
      env: {},
      userDataPath: '/tmp/varlens-user-data',
      fileExists: () => false,
      keyStore
    })

    expect(keyStore.createPendingManagedKey).toHaveBeenCalledWith(
      '/tmp/varlens-user-data/varlens.db'
    )
    expect(keyStore.createManagedKey).not.toHaveBeenCalled()
    expect(manager.createDatabase).toHaveBeenCalledWith(
      '/tmp/varlens-user-data/varlens.db',
      'the-dek'
    )
    expect(keyStore.activateKey).toHaveBeenCalledWith('pending-k1')
    expect(manager.open).not.toHaveBeenCalled()
  })

  it('rolls back the managed key-store entry and rethrows when creating the default sqlite database fails', async () => {
    const manager = {
      open: vi.fn().mockResolvedValue(undefined),
      createDatabase: vi.fn().mockRejectedValue(new Error('disk full')),
      openPostgresSession: vi.fn().mockResolvedValue(undefined)
    }
    const keyStore = {
      createManagedKey: vi.fn().mockReturnValue({ ok: true, keyId: 'k1', dek: 'the-dek' }),
      wrapNewDekWithPassphrase: vi.fn(),
      resolveKeyForPath: vi.fn(),
      resolveKeyWithPassphrase: vi.fn(),
      removeKey: vi.fn()
    }

    const { openConfiguredDatabase } = await import('../../../src/main/database/startup')

    await expect(
      openConfiguredDatabase(manager as never, {
        env: {},
        userDataPath: '/tmp/varlens-user-data',
        fileExists: () => false,
        keyStore
      })
    ).rejects.toThrow('disk full')

    // The registry entry minted before `createDatabase` was attempted must be
    // rolled back -- otherwise the NEXT launch would find a stale
    // `path-already-keyed` entry and silently fall through to an unencrypted
    // default DB.
    expect(keyStore.removeKey).toHaveBeenCalledWith('k1')
  })

  it('BLOCKER 2: does NOT fall back to a plaintext default database when the key-store cannot mint a managed key pre-window; starts with no active database instead', async () => {
    const manager = {
      open: vi.fn().mockResolvedValue(undefined),
      createDatabase: vi.fn().mockResolvedValue(undefined),
      openPostgresSession: vi.fn().mockResolvedValue(undefined)
    }
    const keyStore = {
      createManagedKey: vi.fn().mockReturnValue({ ok: false, reason: 'safe-storage-unavailable' }),
      wrapNewDekWithPassphrase: vi.fn(),
      resolveKeyForPath: vi.fn(),
      resolveKeyWithPassphrase: vi.fn(),
      removeKey: vi.fn()
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

      // Never silently fall back to plaintext: neither create nor open is
      // called at all, so the manager stays in its natural "no active
      // database" state -- exactly what `initDatabaseManagerSafe` produces.
      expect(manager.createDatabase).not.toHaveBeenCalled()
      expect(manager.open).not.toHaveBeenCalled()
      expect(warnSpy).toHaveBeenCalledOnce()
      expect(warnSpy.mock.calls[0]?.[0]).toContain('safe-storage-unavailable')
      expect(warnSpy.mock.calls[0]?.[0]).not.toContain('created without encryption')
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('BLOCKER 2: does NOT fall back to plaintext when the key-store reports path-already-keyed pre-window either', async () => {
    const manager = {
      open: vi.fn().mockResolvedValue(undefined),
      createDatabase: vi.fn().mockResolvedValue(undefined),
      openPostgresSession: vi.fn().mockResolvedValue(undefined)
    }
    const keyStore = {
      createManagedKey: vi.fn().mockReturnValue({ ok: false, reason: 'path-already-keyed' }),
      wrapNewDekWithPassphrase: vi.fn(),
      resolveKeyForPath: vi.fn(),
      resolveKeyWithPassphrase: vi.fn(),
      removeKey: vi.fn()
    }

    const { openConfiguredDatabase } = await import('../../../src/main/database/startup')

    await openConfiguredDatabase(manager as never, {
      env: {},
      userDataPath: '/tmp/varlens-user-data',
      fileExists: () => false,
      keyStore
    })

    expect(manager.createDatabase).not.toHaveBeenCalled()
    expect(manager.open).not.toHaveBeenCalled()
  })

  it('BLOCKER 2: an EXISTING plaintext default database still opens as before (no key-store entry, safeStorage unavailable)', async () => {
    const manager = {
      open: vi.fn().mockResolvedValue(undefined),
      createDatabase: vi.fn().mockResolvedValue(undefined),
      openPostgresSession: vi.fn().mockResolvedValue(undefined)
    }
    const keyStore = {
      createManagedKey: vi.fn().mockReturnValue({ ok: false, reason: 'safe-storage-unavailable' }),
      wrapNewDekWithPassphrase: vi.fn(),
      resolveKeyForPath: vi.fn().mockReturnValue({ ok: false, reason: 'not-found' }),
      resolveKeyWithPassphrase: vi.fn(),
      removeKey: vi.fn()
    }

    const { openConfiguredDatabase } = await import('../../../src/main/database/startup')

    await openConfiguredDatabase(manager as never, {
      env: {},
      userDataPath: '/tmp/varlens-user-data',
      fileExists: () => true,
      keyStore
    })

    // File already exists (a pre-existing plaintext DB): the create path is
    // never reached, so a missing keyring can't block opening it.
    expect(manager.open).toHaveBeenCalledWith('/tmp/varlens-user-data/varlens.db')
    expect(manager.createDatabase).not.toHaveBeenCalled()
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
      resolveKeyWithPassphrase: vi.fn(),
      removeKey: vi.fn()
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
