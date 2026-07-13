import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { Pool } from 'pg'

import type { DbKeyStore, DbKeyStoreLike } from './db-key-store'
import type { DatabaseManager } from '../services/DatabaseManager'
import { mainLogger } from '../services/MainLogger'
import {
  buildPostgresPoolConfig,
  getPostgresStorageConfig,
  type PostgresStorageConfig
} from '../storage/config'
import { PostgresStorageSession } from '../storage/postgres/PostgresStorageSession'
import { PostgresMigrationRunner } from '../storage/postgres/migrations/PostgresMigrationRunner'
import type { StorageSession } from '../storage/session'
import { removeRecoverySidecar } from './recovery-sidecar'

type StartupKeyStore = DbKeyStoreLike &
  Partial<
    Pick<
      DbKeyStore,
      'getKeyStateForPath' | 'getKeyIdForPath' | 'activateKey' | 'createPendingManagedKey'
    >
  >

interface OpenConfiguredDatabaseOptions {
  env?: NodeJS.ProcessEnv
  userDataPath: string
  getPostgresConfig?: (env: NodeJS.ProcessEnv) => PostgresStorageConfig | null
  createPostgresPool?: (config: PostgresStorageConfig) => Pool
  createPostgresSession?: (config: PostgresStorageConfig, pool: Pool) => StorageSession
  /**
   * DB key-store used to encrypt a freshly-created default database by
   * default, and to transparently resolve an existing encrypted default
   * database on subsequent launches. Optional so callers that only exercise
   * the postgres branch (or want today's always-unencrypted default DB in a
   * test) don't need to supply one; defaults to a store that always reports
   * "unavailable" -- this module stays Electron-free (no `safeStorage`
   * import) so it can be unit-tested without mocking `electron`. The real
   * app wires the actual singleton in from `database/index.ts`.
   */
  keyStore?: StartupKeyStore
  /** Injectable for tests; defaults to `fs.existsSync`. */
  fileExists?: (path: string) => boolean
}

function createUnavailableKeyStore(): StartupKeyStore {
  return {
    createManagedKey: () => ({ ok: false, reason: 'safe-storage-unavailable' }),
    wrapNewDekWithPassphrase: () => ({ ok: false, reason: 'path-already-keyed' }),
    resolveKeyForPath: () => ({ ok: false, reason: 'not-found' }),
    resolveKeyWithPassphrase: () => ({ ok: false, reason: 'not-found' }),
    removeKey: () => undefined
  }
}

function getExperimentalBackend(env: NodeJS.ProcessEnv): string | null {
  const backend = env.VARLENS_EXPERIMENTAL_STORAGE_BACKEND?.trim()
  return backend === undefined || backend === '' ? null : backend
}

export async function openConfiguredDatabase(
  manager: DatabaseManager,
  options: OpenConfiguredDatabaseOptions
): Promise<void> {
  const env = options.env ?? process.env
  const requestedBackend = getExperimentalBackend(env)

  if (requestedBackend === 'postgres') {
    const config = (options.getPostgresConfig ?? getPostgresStorageConfig)(env)

    if (config === null) {
      throw new Error(
        'VARLENS_EXPERIMENTAL_STORAGE_BACKEND=postgres requires PostgreSQL configuration, including VARLENS_PG_URL'
      )
    }

    const poolFactory =
      options.createPostgresPool ??
      ((pgConfig: PostgresStorageConfig) => new Pool(buildPostgresPoolConfig(pgConfig)))
    const sessionFactory =
      options.createPostgresSession ??
      ((pgConfig: PostgresStorageConfig, pool: Pool) =>
        new PostgresStorageSession({ config: pgConfig, pool }))

    const pool = poolFactory(config)
    let session: StorageSession | undefined

    try {
      const { POSTGRES_MIGRATIONS } = await import('../storage/postgres/migrations/definitions')
      const runner = new PostgresMigrationRunner(pool, config.schema, POSTGRES_MIGRATIONS)
      await runner.migrate()
      session = sessionFactory(config, pool)
      await manager.openPostgresSession(session)
      return
    } catch (error) {
      await closePostgresStartupResources({ error, pool, session })
      throw error
    }
  }

  await openDefaultSqliteDatabase(
    manager,
    options.userDataPath,
    options.keyStore ?? createUnavailableKeyStore(),
    options.fileExists ?? existsSync
  )
}

/**
 * Open (or create) the default SQLite database at `<userDataPath>/varlens.db`.
 *
 * - File doesn't exist yet (fresh install): create it encrypted by default
 *   via a managed key. If the key-store can't mint one (safeStorage
 *   unavailable pre-window, or a stale registry entry for this exact path),
 *   fall back to creating it unencrypted -- startup must never block on
 *   encryption -- and log clearly so the gap is visible. A later flow (I2b)
 *   can offer to encrypt it once the window is up and a passphrase can be
 *   collected.
 * - File exists: open as today, but first try to resolve a managed key
 *   transparently so a default DB that a PRIOR launch auto-encrypted keeps
 *   opening without a prompt. A DB with no key-store entry (plaintext, or
 *   encrypted some other way) opens exactly as before.
 */
async function openDefaultSqliteDatabase(
  manager: DatabaseManager,
  userDataPath: string,
  keyStore: StartupKeyStore,
  fileExists: (path: string) => boolean
): Promise<void> {
  const defaultDbPath = join(userDataPath, 'varlens.db')

  if (fileExists(defaultDbPath)) {
    const pendingKeyId =
      keyStore.getKeyStateForPath?.(defaultDbPath) === 'pending'
        ? (keyStore.getKeyIdForPath?.(defaultDbPath) ?? null)
        : null
    if (pendingKeyId !== null) {
      const { needsPassword } = manager.openDetectEncryption(defaultDbPath)
      if (!needsPassword) {
        await manager.open(defaultDbPath)
        keyStore.removeKey(pendingKeyId)
        try {
          removeRecoverySidecar(defaultDbPath)
        } catch (error) {
          mainLogger.warn(
            `Failed to remove abandoned migration recovery sidecar: ${error instanceof Error ? error.message : String(error)}`,
            'database-startup'
          )
        }
        return
      }

      const pendingResolved = keyStore.resolveKeyForPath(defaultDbPath)
      if (pendingResolved.ok) {
        await manager.open(defaultDbPath, pendingResolved.dek)
        keyStore.activateKey?.(pendingKeyId)
      } else {
        mainLogger.warn(
          'An encrypted migration is pending and requires its recovery passphrase. Starting ' +
            'without an active database so the user can reopen it interactively.',
          'database-startup'
        )
      }
      return
    }

    const resolved = keyStore.resolveKeyForPath(defaultDbPath)
    if (resolved.ok) {
      await manager.open(defaultDbPath, resolved.dek)
    } else {
      await manager.open(defaultDbPath)
    }
    return
  }

  if (keyStore.getKeyStateForPath?.(defaultDbPath) === 'pending') {
    const abandonedKeyId = keyStore.getKeyIdForPath?.(defaultDbPath)
    if (abandonedKeyId !== undefined && abandonedKeyId !== null) {
      keyStore.removeKey(abandonedKeyId)
      try {
        removeRecoverySidecar(defaultDbPath)
      } catch (error) {
        mainLogger.warn(
          `Failed to remove abandoned database-creation sidecar: ${error instanceof Error ? error.message : String(error)}`,
          'database-startup'
        )
      }
    }
  }

  const managed =
    keyStore.createPendingManagedKey?.(defaultDbPath) ?? keyStore.createManagedKey(defaultDbPath)
  if (managed.ok) {
    try {
      await manager.createDatabase(defaultDbPath, managed.dek)
      keyStore.activateKey?.(managed.keyId)
    } catch (error) {
      // The registry entry was written before the DB file exists. If
      // creation fails, roll it back so the path isn't permanently burned --
      // otherwise the NEXT launch would find a stale `path-already-keyed`
      // entry here and silently fall through to an unencrypted default DB.
      keyStore.removeKey(managed.keyId)
      throw error
    }
    return
  }

  // A managed (safeStorage-wrapped) key could not be minted for the default
  // database -- most commonly because no OS keyring is available before the
  // application window opens. Encryption-by-default means the app must
  // NEVER silently fall back to creating a PLAINTEXT default database here:
  // leave the manager with no active database open (it already tolerates
  // this state -- see `initDatabaseManagerSafe`) so the renderer's
  // passphrase-required create flow (`needsPassphraseSetup`, handled in
  // `createDatabase` in `database-lifecycle-logic.ts`) is what actually
  // creates the (still encrypted, passphrase-wrapped) database once the user
  // supplies a passphrase.
  mainLogger.warn(
    `Default database was NOT created (reason: ${managed.reason}). Secure key storage is ` +
      'unavailable before the application window opens, so an encrypted-by-default database ' +
      'could not be created automatically at startup, and creating it unencrypted would break ' +
      'the encryption-by-default guarantee. Starting with no active database -- create one from ' +
      'the UI to set a passphrase.',
    'database-startup'
  )
}

async function closePostgresStartupResources({
  error,
  pool,
  session
}: {
  error: unknown
  pool: Pool
  session: StorageSession | undefined
}): Promise<void> {
  try {
    if (session !== undefined) {
      await session.close()
      return
    }

    await pool.end()
  } catch (cleanupError) {
    if (error instanceof Error) {
      const errorWithCleanup = error as Error & { cleanupError?: unknown }
      errorWithCleanup.cleanupError = cleanupError
      return
    }

    const combinedError = new Error('Database startup failed and cleanup failed') as Error & {
      errors: unknown[]
    }
    combinedError.errors = [error, cleanupError]
    throw combinedError
  }
}
