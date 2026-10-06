import type { Case } from '../../shared/types/database'
import type { StorageImportExecutor } from './import-executor'
import type { StorageReadExecutor } from './read-executor'
import type { StorageCapabilities, StorageHealth, WorkspaceRef } from './types'
import type { StorageWriteExecutor } from './write-executor'

export interface StorageSession {
  readonly workspace: WorkspaceRef
  readonly capabilities: StorageCapabilities

  listCases(): Promise<Case[]>
  getReadExecutor(): StorageReadExecutor
  getWriteExecutor(): StorageWriteExecutor
  getImportExecutor(): StorageImportExecutor
  // The former getDatabaseService() / getDbPool() escape hatches are off the
  // interface. Backend-specific access (e.g. for SQLite-only flows like
  // SqliteImportExecutor) goes through concrete class methods, with the
  // consumer type-narrowing on capabilities.backend first. New domain logic
  // must use getReadExecutor() / getWriteExecutor().
  getEncryptionKey(): string | undefined
  needsStartupRebuild(): boolean
  /** Resolves once every connection of the session uses the new key; rejects with nothing changed. */
  rekey(newPassword: string): Promise<void>
  close(): Promise<void>
  health(): Promise<StorageHealth>
}
