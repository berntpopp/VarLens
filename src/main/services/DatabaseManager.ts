/**
 * DatabaseManager - Manages database lifecycle with encryption support
 *
 * Provides open/close/switch operations with rollback on failure.
 * Handles encryption detection and password validation.
 */

import { DatabaseService } from '../database/DatabaseService'
import { DatabaseError, WrongPasswordError } from '../database/errors'
import { RecentDatabasesService, type RecentDatabase } from './RecentDatabasesService'
import { mainLogger } from './MainLogger'
import { SqliteStorageSession } from '../storage/sqlite/SqliteStorageSession'
import type { StorageSession } from '../storage/session'

/**
 * DatabaseManager class
 *
 * Centralized lifecycle manager for database connections.
 * Ensures safe switching between databases with rollback on failure.
 */
export class DatabaseManager {
  private currentSession: StorageSession | null = null
  private recentDatabases: RecentDatabasesService

  /**
   * Create a DatabaseManager
   *
   * @param recentDatabases - Service for managing recent databases list
   */
  constructor(recentDatabases: RecentDatabasesService) {
    this.recentDatabases = recentDatabases
  }

  /**
   * Open a database at the specified path
   *
   * Closes current database if open. Validates encryption password if provided.
   *
   * @param dbPath - Path to the database file
   * @param key - Optional encryption key
   * @throws WrongPasswordError if password is incorrect
   * @throws DatabaseError if database cannot be opened
   */
  async open(dbPath: string, key?: string): Promise<void> {
    try {
      await this.close()

      const newSession = this.createSqliteSession(dbPath, key)
      this.currentSession = newSession
      this.recentDatabases.addRecent(dbPath)
    } catch (error) {
      if (error instanceof WrongPasswordError) {
        throw error
      }

      throw new DatabaseError(
        `Failed to open database at ${dbPath}`,
        error instanceof Error ? error : undefined
      )
    }
  }

  async openSqlite(path: string, key?: string): Promise<void> {
    await this.open(path, key)
  }

  /**
   * Detect if a database is encrypted without fully opening it
   *
   * @param dbPath - Path to the database file
   * @returns Object indicating if password is needed
   * @throws DatabaseError if database cannot be read
   */
  openDetectEncryption(dbPath: string): { needsPassword: boolean } {
    let testDb: DatabaseService | null = null

    try {
      testDb = new DatabaseService(dbPath)
      testDb.database.prepare('SELECT count(*) FROM sqlite_master').get()
      testDb.close()
      return { needsPassword: false }
    } catch (error) {
      if (testDb !== null) {
        try {
          testDb.close()
        } catch (e) {
          mainLogger.warn(
            'Failed to close test DB during encryption detection: ' +
              (e instanceof Error ? e.message : String(e)),
            'DatabaseManager'
          )
        }
      }

      if (
        error instanceof Error &&
        error.message.includes('file is encrypted or is not a database')
      ) {
        return { needsPassword: true }
      }

      throw new DatabaseError(
        `Failed to read database at ${dbPath}`,
        error instanceof Error ? error : undefined
      )
    }
  }

  detectSqliteEncryption(path: string): { needsPassword: boolean } {
    return this.openDetectEncryption(path)
  }

  /**
   * Create a new database at the specified path
   *
   * Closes current database if open. Creates encrypted database if key provided.
   *
   * @param dbPath - Path for the new database file
   * @param key - Optional encryption key
   * @throws DatabaseError if database cannot be created
   */
  async createDatabase(dbPath: string, key?: string): Promise<void> {
    try {
      await this.close()

      const newSession = this.createSqliteSession(dbPath, key)
      this.currentSession = newSession
      this.recentDatabases.addRecent(dbPath)
    } catch (error) {
      throw new DatabaseError(
        `Failed to create database at ${dbPath}`,
        error instanceof Error ? error : undefined
      )
    }
  }

  async createSqlite(path: string, key?: string): Promise<void> {
    await this.createDatabase(path, key)
  }

  /**
   * Switch to a different database with rollback on failure
   *
   * Implements safe switching: if new database fails to open,
   * the previous database is restored.
   *
   * @param newPath - Path to the database to switch to
   * @param key - Optional encryption key
   * @throws WrongPasswordError if password is incorrect
   * @throws DatabaseError if switch fails and rollback succeeds
   */
  async switchDatabase(newPath: string, key?: string): Promise<void> {
    const previousSession = this.currentSession
    let newSession: StorageSession | null = null

    try {
      newSession = this.createSqliteSession(newPath, key)
      this.currentSession = newSession
      this.recentDatabases.addRecent(newPath)

      if (previousSession !== null) {
        try {
          await previousSession.close()
        } catch (error) {
          mainLogger.warn(
            'Failed to close previous session during database switch: ' +
              (error instanceof Error ? error.message : String(error)),
            'DatabaseManager'
          )
        }
      }
    } catch (error) {
      this.currentSession = previousSession

      if (error instanceof WrongPasswordError) {
        throw error
      }

      if (newSession !== null && newSession !== previousSession) {
        try {
          await newSession.close()
        } catch (closeError) {
          mainLogger.warn(
            'Failed to close newly created session after switch failure: ' +
              (closeError instanceof Error ? closeError.message : String(closeError)),
            'DatabaseManager'
          )
        }
      }

      throw new DatabaseError(
        `Failed to switch to database at ${newPath}`,
        error instanceof Error ? error : undefined
      )
    }
  }

  async switchToSqlite(path: string, key?: string): Promise<void> {
    await this.switchDatabase(path, key)
  }

  async openPostgresSession(session: StorageSession): Promise<void> {
    const isPostgresSession =
      session.workspace.kind === 'postgres' && session.capabilities.backend === 'postgres'

    if (!isPostgresSession) {
      throw new DatabaseError('openPostgresSession requires a postgres-backed session')
    }

    await this.close()
    this.currentSession = session
  }

  /**
   * Close the current database
   *
   * Safely closes the database connection and clears cached statements.
   * Safe to call even if no database is open.
   */
  async close(): Promise<void> {
    if (this.currentSession !== null) {
      const session = this.currentSession
      this.currentSession = null
      await session.close()
    }
  }

  getCurrentSession(): StorageSession {
    if (this.currentSession === null) {
      throw new DatabaseError('No database is currently open')
    }

    return this.currentSession
  }

  /**
   * Get the current database service
   *
   * @returns Current database service
   * @throws DatabaseError if no database is open
   */
  getCurrent(): DatabaseService {
    return this.getCurrentSession().getDatabaseService()
  }

  /**
   * Get the current database path
   *
   * @returns Path to current database, or null if none open
   */
  getCurrentPath(): string | null {
    if (this.currentSession?.workspace.kind !== 'sqlite') {
      return null
    }

    return this.currentSession.workspace.path
  }

  /**
   * Get information about the current database
   *
   * @returns Database info object, or null if no database is open
   */
  getCurrentInfo(): { path: string; name: string; encrypted: boolean } | null {
    if (this.currentSession?.workspace.kind !== 'sqlite') {
      return null
    }

    return {
      path: this.currentSession.workspace.path,
      name: this.currentSession.workspace.name,
      encrypted: this.currentSession.workspace.encrypted
    }
  }

  /**
   * Change the encryption key for the current database
   *
   * @param newPassword - New encryption password
   * @throws DatabaseError if no database is open or rekey fails
   */
  rekey(newPassword: string): void {
    this.getCurrentSession().rekey(newPassword)
  }

  /**
   * Get the recent databases list
   *
   * @returns Array of recent databases
   */
  getRecentDatabases(): RecentDatabase[] {
    return this.recentDatabases.getRecent()
  }

  /**
   * Remove a database from the recent list
   *
   * @param dbPath - Path to the database to remove from recent list
   */
  removeRecentDatabase(dbPath: string): void {
    this.recentDatabases.removeRecent(dbPath)
  }

  private createSqliteSession(dbPath: string, key?: string): StorageSession {
    const newDb = new DatabaseService(dbPath, key)

    if (key !== undefined && key.length > 0) {
      try {
        newDb.database.prepare('SELECT count(*) FROM sqlite_master').get()
      } catch (error) {
        newDb.close()

        if (
          error instanceof Error &&
          error.message.includes('file is encrypted or is not a database')
        ) {
          throw new WrongPasswordError()
        }

        throw error
      }
    }

    return new SqliteStorageSession({
      databaseService: newDb,
      dbPool: null
    })
  }
}
