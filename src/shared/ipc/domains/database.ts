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
