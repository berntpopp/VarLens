import type { StorageSession } from './session'

export interface StorageManager {
  openSqlite(path: string, key?: string): Promise<void>
  createSqlite(path: string, key?: string): Promise<void>
  switchToSqlite(path: string, key?: string): Promise<void>
  detectSqliteEncryption(path: string): { needsPassword: boolean }
  getCurrentSession(): StorageSession
  getCurrentPath(): string | null
  close(): Promise<void>
}
