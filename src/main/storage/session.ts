import type { DatabaseService } from '../database/DatabaseService'
import type { DbPool } from '../database/DbPool'
import type { StorageCapabilities, StorageHealth, WorkspaceRef } from './types'

export interface StorageSession {
  readonly workspace: WorkspaceRef
  readonly capabilities: StorageCapabilities

  getDatabaseService(): DatabaseService
  getDbPool(): DbPool | null
  getEncryptionKey(): string | undefined
  needsStartupRebuild(): boolean
  rekey(newPassword: string): void
  close(): Promise<void>
  health(): Promise<StorageHealth>
}
