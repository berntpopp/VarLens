import type { DatabaseOverview } from '../../types/database-overview'
import type { IpcResult } from '../../types/errors'
import type {
  PostgresConnectionProfileInput,
  PostgresConnectionProfilePublic,
  PostgresConnectionProfileSaveInput,
  PostgresConnectionTestResult,
  PostgresHealthDiagnosticResult
} from '../../types/postgres-profile'
import type { StorageCapabilities } from '../../types/storage-capabilities'

export interface DatabaseInfo {
  path: string
  name: string
  encrypted: boolean
  /**
   * True when this is a currently-open, plaintext, local SQLite database --
   * i.e. it is eligible for the `migrateToEncrypted` action. Absent/false for
   * encrypted databases and for non-SQLite (e.g. PostgreSQL) sessions.
   */
  unencryptedMigratable?: boolean
}

export interface DatabaseOpenResult {
  success: boolean
  needsPassword?: boolean
  /**
   * Set on a `create` call when no password/DEK could be minted transparently
   * (safeStorage unavailable). The caller must collect a passphrase from the
   * user and re-call `create(path, undefined, setupPassphrase)`.
   */
  needsPassphraseSetup?: boolean
  error?: string
  info?: DatabaseInfo
}

export interface RecentDatabase {
  path: string
  name: string
  lastOpened: number
}

export interface DatabaseActionResult {
  success: boolean
}

export interface MigrateToEncryptedOptions {
  /**
   * Must be `true` -- migration is only ever performed with explicit user
   * consent. Never inferred or defaulted; a request without consent is
   * refused before anything is touched.
   */
  consent: boolean
  /**
   * Recovery passphrase for the migrated database's key.
   *  - REQUIRED when no OS keyring (safeStorage) is available -- the DEK is
   *    then wrapped ONLY by this passphrase.
   *  - OPTIONAL (but strongly encouraged) when a keyring is available -- it
   *    is set as an additional recovery wrap on the managed key, so keyring
   *    loss (e.g. OS reinstall) does not make the data unrecoverable.
   */
  recoveryPassphrase?: string
}

export interface MigrateToEncryptedResult {
  success: boolean
  error?: string
  /** Path to the plaintext backup kept alongside the database after a successful migration. */
  backupPath?: string
  /** Whether a recovery passphrase is now set on the migrated key. */
  recoveryPassphraseSet?: boolean
  info?: DatabaseInfo
}

export interface DatabaseDomainContract {
  selectFile: () => Promise<string | null>
  selectSaveLocation: (defaultName: string) => Promise<string | null>
  open: (path: string, password?: string) => Promise<IpcResult<DatabaseOpenResult>>
  /**
   * `setupPassphrase` is only used to complete the safeStorage-unavailable
   * fallback signalled by a prior `create` call's `needsPassphraseSetup`.
   * It wraps a freshly generated DEK -- it is never itself the SQLCipher key.
   */
  create: (
    path: string,
    password?: string,
    setupPassphrase?: string
  ) => Promise<IpcResult<DatabaseOpenResult>>
  rekey: (newPassword: string) => Promise<IpcResult<DatabaseActionResult>>
  /**
   * Migrate the currently-open, plaintext SQLite database to encrypted-at-rest.
   * Requires explicit consent; see `MigrateToEncryptedOptions`. Reversible:
   * a plaintext backup is kept until the caller explicitly deletes it via
   * `deletePlaintextBackup`.
   */
  migrateToEncrypted: (
    options: MigrateToEncryptedOptions
  ) => Promise<IpcResult<MigrateToEncryptedResult>>
  /**
   * Delete a plaintext backup produced by a prior `migrateToEncrypted` call.
   * Only accepts a path that matches the currently-open database's backup
   * naming pattern -- cannot target an arbitrary file.
   */
  deletePlaintextBackup: (backupPath: string) => Promise<IpcResult<DatabaseActionResult>>
  info: () => Promise<IpcResult<DatabaseInfo | null>>
  capabilities: () => Promise<IpcResult<StorageCapabilities>>
  postgresDiagnostics: () => Promise<IpcResult<PostgresHealthDiagnosticResult>>
  postgresProfilesList: () => Promise<IpcResult<PostgresConnectionProfilePublic[]>>
  postgresProfileSave: (
    input: PostgresConnectionProfileSaveInput
  ) => Promise<IpcResult<PostgresConnectionProfilePublic>>
  postgresProfileRemove: (profileId: string) => Promise<IpcResult<DatabaseActionResult>>
  postgresProfileTest: (
    input: PostgresConnectionProfileInput
  ) => Promise<IpcResult<PostgresConnectionTestResult>>
  postgresProfileOpen: (profileId: string) => Promise<IpcResult<DatabaseOpenResult>>
  recentList: () => Promise<IpcResult<RecentDatabase[]>>
  getOverview: () => Promise<IpcResult<DatabaseOverview>>
  removeRecent: (path: string) => Promise<IpcResult<DatabaseActionResult>>
  deleteFile: (path: string) => Promise<IpcResult<DatabaseActionResult>>
  showInFolder: (path: string) => Promise<IpcResult<DatabaseActionResult>>
}
