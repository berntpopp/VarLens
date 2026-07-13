/**
 * Database IPC handlers - Lifecycle operations for database management
 *
 * Exposes database open/close/switch/create/rekey operations to renderer.
 * Handles encryption detection and password validation.
 * Dialog operations and shell access stay in this handler layer.
 */

import { app, dialog, safeStorage, shell } from 'electron'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import { wrapHandler } from '../errorHandler'
import { InvalidParametersError } from '../errors'
import type { HandlerDependencies } from '../types'
import { mainLogger } from '../../services/MainLogger'
import {
  addAllowedDatabasePath,
  isAllowedDatabasePath
} from '../../security/database-path-allowlist'
import {
  DatabaseOpenSchema,
  DatabaseCreateSchema,
  DatabaseRekeySchema,
  DatabaseMigrateToEncryptedSchema,
  DatabaseDeletePlaintextBackupSchema,
  DatabaseSetRecoveryPassphraseSchema,
  FilePathSchema
} from '../../../shared/types/ipc-schemas'
import { getDbKeyStore as getDefaultDbKeyStore } from '../../database/db-key-store-instance'
import { triggerStartupRebuildIfNeeded } from './cohort'
import {
  openDatabase,
  createDatabase,
  rekeyDatabase,
  setRecoveryPassphrase,
  getDatabaseInfo,
  getDatabaseCapabilities,
  getPostgresDiagnostics,
  getRecentDatabases,
  getDatabaseOverview,
  removeRecentDatabase,
  deleteDbFile,
  listPostgresProfiles,
  savePostgresProfile,
  removePostgresProfile,
  testPostgresProfile,
  openPostgresProfile,
  createDefaultPostgresPool,
  createPostgresStorageSession,
  PostgresProfileIdSchema
} from './database-logic'
import type { DatabaseLifecycleCallbacks } from './database-logic'
import { migrateCurrentToEncrypted, deletePlaintextBackup } from './database-migration-logic'
import { PostgresProfileStore, type SecretStore } from '../../storage/postgres/PostgresProfileStore'
import {
  PostgresConnectionProfileInputSchema,
  PostgresConnectionProfileSaveInputSchema
} from '../../storage/postgres/postgres-profile-validation'

/** Shared lifecycle callbacks wiring pool init and cohort rebuild. */
const lifecycleCallbacks: DatabaseLifecycleCallbacks = {
  triggerStartupRebuild: (db) => triggerStartupRebuildIfNeeded(db)
}

interface EncryptedSecretFile {
  secrets?: Record<string, string>
}

class ElectronSafeStorageSecretStore implements SecretStore {
  constructor(private readonly secretPath: string) {}

  async set(key: string, value: string): Promise<void> {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Secure credential storage is not available on this system')
    }

    const data = await this.readSecrets()
    data.secrets[key] = safeStorage.encryptString(value).toString('base64')
    await this.writeSecrets(data)
  }

  async get(key: string): Promise<string | null> {
    const data = await this.readSecrets()
    const encrypted = data.secrets[key]
    if (encrypted === undefined) {
      return null
    }

    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Secure credential storage is not available on this system')
    }

    return safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
  }

  async delete(key: string): Promise<void> {
    const data = await this.readSecrets()
    delete data.secrets[key]
    await this.writeSecrets(data)
  }

  private async readSecrets(): Promise<{ secrets: Record<string, string> }> {
    try {
      const raw = await readFile(this.secretPath, 'utf8')
      const parsed = JSON.parse(raw) as EncryptedSecretFile
      return {
        secrets:
          parsed.secrets !== undefined && typeof parsed.secrets === 'object' ? parsed.secrets : {}
      }
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return { secrets: {} }
      }
      throw error
    }
  }

  private async writeSecrets(data: { secrets: Record<string, string> }): Promise<void> {
    await mkdir(dirname(this.secretPath), { recursive: true })
    await writeFile(this.secretPath, JSON.stringify(data, null, 2), 'utf8')
  }
}

class InsecureLocalPostgresSecretStore implements SecretStore {
  constructor(private readonly secretPath: string) {}

  async set(key: string, value: string): Promise<void> {
    const data = await this.readSecrets()
    data.secrets[key] = value
    await this.writeSecrets(data)
  }

  async get(key: string): Promise<string | null> {
    const data = await this.readSecrets()
    return data.secrets[key] ?? null
  }

  async delete(key: string): Promise<void> {
    const data = await this.readSecrets()
    delete data.secrets[key]
    await this.writeSecrets(data)
  }

  private async readSecrets(): Promise<{ secrets: Record<string, string> }> {
    try {
      const raw = await readFile(this.secretPath, 'utf8')
      const parsed = JSON.parse(raw) as EncryptedSecretFile
      return {
        secrets:
          parsed.secrets !== undefined && typeof parsed.secrets === 'object' ? parsed.secrets : {}
      }
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return { secrets: {} }
      }
      throw error
    }
  }

  private async writeSecrets(data: { secrets: Record<string, string> }): Promise<void> {
    await mkdir(dirname(this.secretPath), { recursive: true })
    await writeFile(this.secretPath, JSON.stringify(data, null, 2), 'utf8')
  }
}

let defaultPostgresProfileStore: PostgresProfileStore | null = null
let insecureSecretStoreWarned = false

function warnIfInsecureSecretStore(): void {
  if (insecureSecretStoreWarned) {
    return
  }

  if (process.env.VARLENS_POSTGRES_PROFILE_SECRET_STORE === 'insecure-local') {
    mainLogger.warn(
      'VARLENS_POSTGRES_PROFILE_SECRET_STORE=insecure-local is active. ' +
        'PostgreSQL profile credentials are stored in plaintext. ' +
        'Unset this env var or set it to a secure backend before any production-like workflow.',
      'database-handler'
    )
    insecureSecretStoreWarned = true
  }
}

function getDefaultPostgresProfileStore(): PostgresProfileStore {
  if (defaultPostgresProfileStore === null) {
    const userDataPath = app.getPath('userData')
    warnIfInsecureSecretStore()
    const secretStore =
      process.env.VARLENS_POSTGRES_PROFILE_SECRET_STORE === 'insecure-local'
        ? createInsecureLocalPostgresSecretStore(userDataPath)
        : new ElectronSafeStorageSecretStore(join(userDataPath, 'varlens-postgres-secrets.json'))

    defaultPostgresProfileStore = new PostgresProfileStore(
      join(userDataPath, 'varlens-postgres-profiles.json'),
      secretStore
    )
  }

  return defaultPostgresProfileStore
}

function createInsecureLocalPostgresSecretStore(userDataPath: string): SecretStore {
  if (app.isPackaged) {
    throw new Error('Insecure local PostgreSQL secret storage is unavailable in packaged builds')
  }

  return new InsecureLocalPostgresSecretStore(
    join(userDataPath, 'varlens-postgres-secrets.insecure-local.json')
  )
}

/**
 * DB path-authority gate for `database:open` / `database:create` /
 * `database:showInFolder` / `database:removeRecent`.
 *
 * A path is allowed only if it was picked via a dialog this session
 * (`database:selectFile` / `database:selectSaveLocation`, which enroll into
 * a database-scoped session allowlist), already
 * appears in the recent databases list, or is the currently active
 * database. This mirrors the `deleteDbFile` precedent (recent-list +
 * active-DB checks) while still allowing `create`/`open` to work with a
 * freshly dialog-selected path that isn't in the recent list yet.
 *
 * Uses the database-scoped enrollment check so import-file authority cannot
 * authorize a database operation. An arbitrary renderer-supplied string with
 * no dialog/recent/active provenance is rejected even if it happens to live
 * under the user's home directory or the OS temp dir.
 */
function throwUnallowedDatabasePath(channel: string, path: string): never {
  throw new InvalidParametersError(
    `${channel}: path is not in the database path authority set: ${path}`,
    'The selected database file is not in an allowed location.'
  )
}

export function registerDatabaseHandlers({
  ipcMain,
  getDb,
  getDbManager,
  getDbPool,
  getPostgresProfileStore = getDefaultPostgresProfileStore,
  getDbKeyStore = getDefaultDbKeyStore,
  createPostgresPool = createDefaultPostgresPool,
  createPostgresSession = createPostgresStorageSession,
  collectPostgresDiagnostics
}: HandlerDependencies): void {
  /**
   * Show file picker for selecting database file
   */
  ipcMain.handle('database:selectFile', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Open Database',
      properties: ['openFile'],
      filters: [
        { name: 'Database Files', extensions: ['sqlite', 'db', 'sqlite3'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    const filePath = result.filePaths[0]
    addAllowedDatabasePath(filePath)
    return filePath
  })

  /**
   * Show file picker for selecting save location for new database
   */
  ipcMain.handle('database:selectSaveLocation', async (_event, defaultName: unknown) => {
    // ANTI-07: Runtime validation at IPC boundary
    const validated = FilePathSchema.safeParse(defaultName)
    if (!validated.success) {
      mainLogger.error(
        `Invalid database:selectSaveLocation defaultName: ${validated.error.message}`,
        'database'
      )
      throw new Error('Invalid file name')
    }
    const result = await dialog.showSaveDialog({
      title: 'Create New Database',
      defaultPath: validated.data,
      filters: [
        { name: 'Database Files', extensions: ['sqlite', 'db'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })

    if (result.canceled || !result.filePath) {
      return null
    }

    addAllowedDatabasePath(result.filePath)
    return result.filePath
  })

  /**
   * Open a database at the specified path
   */
  ipcMain.handle('database:open', async (_event, path: unknown, password?: unknown) => {
    return wrapHandler(async () => {
      const validated = DatabaseOpenSchema.safeParse({ path, password })
      if (!validated.success) {
        mainLogger.error(`Invalid database:open params: ${validated.error.message}`, 'database')
        throw new Error('Invalid database open parameters')
      }
      if (!isAllowedDatabasePath(validated.data.path, getDbManager)) {
        throwUnallowedDatabasePath('database:open', validated.data.path)
      }
      return openDatabase(validated.data, getDb, getDbManager, lifecycleCallbacks, getDbKeyStore())
    })
  })

  /**
   * Create a new database at the specified path
   */
  ipcMain.handle(
    'database:create',
    async (_event, path: unknown, password?: unknown, setupPassphrase?: unknown) => {
      return wrapHandler(async () => {
        const validated = DatabaseCreateSchema.safeParse({ path, password, setupPassphrase })
        if (!validated.success) {
          mainLogger.error(`Invalid database:create params: ${validated.error.message}`, 'database')
          throw new Error('Invalid database create parameters')
        }
        if (!isAllowedDatabasePath(validated.data.path, getDbManager)) {
          throwUnallowedDatabasePath('database:create', validated.data.path)
        }
        return createDatabase(validated.data, getDbManager, getDbKeyStore())
      })
    }
  )

  /**
   * Change the encryption key for the current database
   */
  ipcMain.handle('database:rekey', async (_event, newPassword: unknown) => {
    return wrapHandler(async () => {
      const validated = DatabaseRekeySchema.safeParse({ newPassword })
      if (!validated.success) {
        mainLogger.error(`Invalid database:rekey params: ${validated.error.message}`, 'database')
        throw new Error('Invalid encryption key')
      }
      return rekeyDatabase(validated.data.newPassword, getDbManager, getDbKeyStore())
    })
  })

  /**
   * Set (or replace) a recovery passphrase on the currently open database's
   * managed key. Non-destructive -- see `setRecoveryPassphrase` in
   * `database-lifecycle-logic.ts` for the full contract.
   */
  ipcMain.handle('database:setRecoveryPassphrase', async (_event, passphrase: unknown) => {
    return wrapHandler(async () => {
      const validated = DatabaseSetRecoveryPassphraseSchema.safeParse({ passphrase })
      if (!validated.success) {
        mainLogger.error(
          `Invalid database:setRecoveryPassphrase params: ${validated.error.message}`,
          'database'
        )
        throw new Error('Invalid recovery passphrase')
      }
      return setRecoveryPassphrase(validated.data.passphrase, getDbManager, getDbKeyStore())
    })
  })

  /**
   * Migrate the currently-open, plaintext SQLite database to encrypted-at-rest.
   * Requires explicit consent; see `database-migration-logic.ts`.
   */
  ipcMain.handle('database:migrateToEncrypted', async (_event, options: unknown) => {
    return wrapHandler(async () => {
      const validated = DatabaseMigrateToEncryptedSchema.safeParse(options)
      if (!validated.success) {
        mainLogger.error(
          `Invalid database:migrateToEncrypted params: ${validated.error.message}`,
          'database'
        )
        throw new Error('Invalid migration parameters')
      }
      return migrateCurrentToEncrypted(
        validated.data,
        getDbManager,
        getDbKeyStore(),
        lifecycleCallbacks
      )
    })
  })

  /**
   * Delete a plaintext backup produced by a prior migration.
   */
  ipcMain.handle('database:deletePlaintextBackup', async (_event, backupPath: unknown) => {
    return wrapHandler(async () => {
      const validated = DatabaseDeletePlaintextBackupSchema.safeParse({ backupPath })
      if (!validated.success) {
        mainLogger.error(
          `Invalid database:deletePlaintextBackup params: ${validated.error.message}`,
          'database'
        )
        throw new Error('Invalid backup path')
      }
      return deletePlaintextBackup(validated.data.backupPath, getDbManager)
    })
  })

  /**
   * Get information about the current database
   */
  ipcMain.handle('database:info', async () => {
    return wrapHandler(async () => {
      return getDatabaseInfo(getDbManager, getDbKeyStore())
    })
  })

  /**
   * Get capability flags for the current storage backend/session
   */
  ipcMain.handle('database:capabilities', async () => {
    return wrapHandler(async () => {
      return getDatabaseCapabilities(getDbManager)
    })
  })

  /**
   * Get PostgreSQL hosted workspace diagnostics for the current session.
   */
  ipcMain.handle('database:postgresDiagnostics', async () => {
    return wrapHandler(async () => {
      return await getPostgresDiagnostics(getDbManager)
    })
  })

  /**
   * List saved PostgreSQL connection profiles.
   */
  ipcMain.handle('database:postgresProfilesList', async () => {
    return wrapHandler(async () => {
      return await listPostgresProfiles(getPostgresProfileStore())
    })
  })

  /**
   * Save a PostgreSQL connection profile. Secrets are written through the
   * profile store's secret backend and are never returned in the public profile.
   */
  ipcMain.handle('database:postgresProfileSave', async (_event, input: unknown) => {
    return wrapHandler(async () => {
      const validated = PostgresConnectionProfileSaveInputSchema.safeParse(input)
      if (!validated.success) {
        mainLogger.error('Invalid database:postgresProfileSave params', 'database')
        throw new Error('Invalid PostgreSQL profile parameters')
      }

      return await savePostgresProfile(validated.data, getPostgresProfileStore())
    })
  })

  /**
   * Remove a saved PostgreSQL connection profile.
   */
  ipcMain.handle('database:postgresProfileRemove', async (_event, profileId: unknown) => {
    return wrapHandler(async () => {
      const validated = PostgresProfileIdSchema.safeParse(profileId)
      if (!validated.success) {
        mainLogger.error('Invalid database:postgresProfileRemove profileId', 'database')
        throw new Error('Invalid PostgreSQL profile id')
      }

      return await removePostgresProfile(validated.data, getPostgresProfileStore())
    })
  })

  /**
   * Test PostgreSQL connection settings without switching the active database.
   */
  ipcMain.handle('database:postgresProfileTest', async (_event, input: unknown) => {
    return wrapHandler(async () => {
      const validated = PostgresConnectionProfileInputSchema.safeParse(input)
      if (!validated.success) {
        mainLogger.error('Invalid database:postgresProfileTest params', 'database')
        throw new Error('Invalid PostgreSQL profile parameters')
      }

      return await testPostgresProfile(validated.data, {
        createPool: createPostgresPool,
        ...(collectPostgresDiagnostics !== undefined
          ? { collectDiagnostics: collectPostgresDiagnostics }
          : {})
      })
    })
  })

  /**
   * Open a saved PostgreSQL profile as the active database session.
   */
  ipcMain.handle('database:postgresProfileOpen', async (_event, profileId: unknown) => {
    return wrapHandler(async () => {
      const validated = PostgresProfileIdSchema.safeParse(profileId)
      if (!validated.success) {
        mainLogger.error('Invalid database:postgresProfileOpen profileId', 'database')
        throw new Error('Invalid PostgreSQL profile id')
      }

      return await openPostgresProfile(validated.data, {
        profileStore: getPostgresProfileStore(),
        getDbManager,
        createSession: createPostgresSession
      })
    })
  })

  /**
   * Get the list of recent databases
   */
  ipcMain.handle('database:recentList', async () => {
    return wrapHandler(async () => {
      return getRecentDatabases(getDbManager)
    })
  })

  /**
   * Get database overview (summary stats, cases, cohorts, tags, phenotypes)
   */
  ipcMain.handle('database:overview', async () => {
    return wrapHandler(async () => {
      const session = getDbManager().getCurrentSession()
      if (session.capabilities.backend === 'postgres') {
        return await session.getReadExecutor().execute({ type: 'database:overview', params: [] })
      }
      return getDatabaseOverview(getDb, getDbPool)
    })
  })

  /**
   * Remove a database from the recent list (does not delete the file)
   */
  ipcMain.handle('database:removeRecent', async (_event, path: unknown) => {
    return wrapHandler(async () => {
      const validated = FilePathSchema.safeParse(path)
      if (!validated.success) {
        mainLogger.error(
          `Invalid database:removeRecent path: ${validated.error.message}`,
          'database'
        )
        throw new Error('Invalid file path')
      }
      if (!isAllowedDatabasePath(validated.data, getDbManager)) {
        throwUnallowedDatabasePath('database:removeRecent', validated.data)
      }
      return removeRecentDatabase(validated.data, getDbManager)
    })
  })

  /**
   * Delete a database file from disk and remove from recent list.
   */
  ipcMain.handle('database:deleteFile', async (_event, path: unknown) => {
    return wrapHandler(async () => {
      const validated = FilePathSchema.safeParse(path)
      if (!validated.success) {
        mainLogger.error(`Invalid database:deleteFile path: ${validated.error.message}`, 'database')
        throw new Error('Invalid file path')
      }
      return deleteDbFile(validated.data, getDbManager, getDbKeyStore())
    })
  })

  /**
   * Reveal a database file in the system file manager
   */
  ipcMain.handle('database:showInFolder', async (_event, path: unknown) => {
    return wrapHandler(async () => {
      const validated = FilePathSchema.safeParse(path)
      if (!validated.success) {
        throw new Error('Invalid file path')
      }
      if (!isAllowedDatabasePath(validated.data, getDbManager)) {
        throwUnallowedDatabasePath('database:showInFolder', validated.data)
      }
      shell.showItemInFolder(validated.data)
      return { success: true }
    })
  })

  mainLogger.info('Database IPC handlers registered', 'database')
}
