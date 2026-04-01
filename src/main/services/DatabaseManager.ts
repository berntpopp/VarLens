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
import { basename } from 'path'

/**
 * DatabaseManager class
 *
 * Centralized lifecycle manager for database connections.
 * Ensures safe switching between databases with rollback on failure.
 */
export class DatabaseManager {
  private currentDb: DatabaseService | null = null
  private currentPath: string | null = null
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
  open(dbPath: string, key?: string): void {
    // Close current database if open
    this.close()

    try {
      // Create new database connection
      const newDb = new DatabaseService(dbPath, key)

      // If key provided, validate by attempting a simple query
      if (key !== undefined && key.length > 0) {
        try {
          newDb.database.prepare('SELECT count(*) FROM sqlite_master').get()
        } catch (error) {
          // Close the failed connection
          newDb.close()

          // Check if error indicates wrong password
          if (
            error instanceof Error &&
            error.message.includes('file is encrypted or is not a database')
          ) {
            throw new WrongPasswordError()
          }
          throw error
        }
      }

      // Success - store as current
      this.currentDb = newDb
      this.currentPath = dbPath
      this.recentDatabases.addRecent(dbPath)
    } catch (error) {
      // Propagate WrongPasswordError as-is
      if (error instanceof WrongPasswordError) {
        throw error
      }

      // Wrap other errors
      throw new DatabaseError(
        `Failed to open database at ${dbPath}`,
        error instanceof Error ? error : undefined
      )
    }
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
      // Try opening without key
      testDb = new DatabaseService(dbPath)
      testDb.database.prepare('SELECT count(*) FROM sqlite_master').get()

      // Success - database is plaintext
      testDb.close()
      return { needsPassword: false }
    } catch (error) {
      // Clean up test connection
      if (testDb) {
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

      // Check if error indicates encryption
      if (
        error instanceof Error &&
        error.message.includes('file is encrypted or is not a database')
      ) {
        return { needsPassword: true }
      }

      // Other error - database is likely corrupt or invalid
      throw new DatabaseError(
        `Failed to read database at ${dbPath}`,
        error instanceof Error ? error : undefined
      )
    }
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
  createDatabase(dbPath: string, key?: string): void {
    // Close current database if open
    this.close()

    try {
      // Create new database (constructor handles PRAGMA key + schema init)
      const newDb = new DatabaseService(dbPath, key)

      // Store as current
      this.currentDb = newDb
      this.currentPath = dbPath
      this.recentDatabases.addRecent(dbPath)
    } catch (error) {
      throw new DatabaseError(
        `Failed to create database at ${dbPath}`,
        error instanceof Error ? error : undefined
      )
    }
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
  switchDatabase(newPath: string, key?: string): void {
    // Save reference to previous database
    const previousDb = this.currentDb
    const previousPath = this.currentPath

    try {
      // Null out current before attempting to open new
      this.currentDb = null
      this.currentPath = null

      // Try to open new database
      const newDb = new DatabaseService(newPath, key)

      // If key provided, validate by attempting a simple query
      if (key !== undefined && key.length > 0) {
        try {
          newDb.database.prepare('SELECT count(*) FROM sqlite_master').get()
        } catch (error) {
          // Close the failed connection
          newDb.close()

          // Check if error indicates wrong password
          if (
            error instanceof Error &&
            error.message.includes('file is encrypted or is not a database')
          ) {
            throw new WrongPasswordError()
          }
          throw error
        }
      }

      // Success - close previous and store new
      if (previousDb) {
        previousDb.close()
      }

      this.currentDb = newDb
      this.currentPath = newPath
      this.recentDatabases.addRecent(newPath)
    } catch (error) {
      // Rollback - restore previous database
      this.currentDb = previousDb
      this.currentPath = previousPath

      // Propagate error
      if (error instanceof WrongPasswordError) {
        throw error
      }

      throw new DatabaseError(
        `Failed to switch to database at ${newPath}`,
        error instanceof Error ? error : undefined
      )
    }
  }

  /**
   * Close the current database
   *
   * Safely closes the database connection and clears cached statements.
   * Safe to call even if no database is open.
   */
  close(): void {
    if (this.currentDb) {
      this.currentDb.close()
      this.currentDb = null
      this.currentPath = null
    }
  }

  /**
   * Get the current database service
   *
   * @returns Current database service
   * @throws DatabaseError if no database is open
   */
  getCurrent(): DatabaseService {
    if (!this.currentDb) {
      throw new DatabaseError('No database is currently open')
    }
    return this.currentDb
  }

  /**
   * Get the current database path
   *
   * @returns Path to current database, or null if none open
   */
  getCurrentPath(): string | null {
    return this.currentPath
  }

  /**
   * Get information about the current database
   *
   * @returns Database info object, or null if no database is open
   */
  getCurrentInfo(): { path: string; name: string; encrypted: boolean } | null {
    if (this.currentDb === null || this.currentPath === null) {
      return null
    }

    return {
      path: this.currentPath,
      name: basename(this.currentPath),
      encrypted: this.currentDb.isEncrypted()
    }
  }

  /**
   * Change the encryption key for the current database
   *
   * @param newPassword - New encryption password
   * @throws DatabaseError if no database is open or rekey fails
   */
  rekey(newPassword: string): void {
    const db = this.getCurrent()
    db.rekey(newPassword)
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
}
