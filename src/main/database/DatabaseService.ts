/**
 * DatabaseService - Core database service for Varlens
 *
 * Manages SQLite connection, schema initialization, and case CRUD operations.
 * Uses better-sqlite3 for synchronous database access with prepared statement caching.
 */

import Database from 'better-sqlite3'
import type { Database as DatabaseType, Statement } from 'better-sqlite3'
import { initializeSchema } from './schema'
import type { Case } from './types'
import { DatabaseError, NotFoundError, UniqueConstraintError, TransactionError } from './errors'

/**
 * DatabaseService class
 *
 * Provides database initialization, case management, and transaction support.
 * Designed for Electron main process usage with optional path override for testing.
 */
export class DatabaseService {
  private db: DatabaseType
  private statementCache: Map<string, Statement>

  /**
   * Create a new DatabaseService instance
   *
   * @param dbPath - Path to SQLite database file. Defaults to ':memory:' for testing.
   *                 In production, pass app.getPath('userData') + '/varlens.db'
   * @throws DatabaseError if database initialization fails
   */
  constructor(dbPath: string = ':memory:') {
    try {
      this.db = new Database(dbPath)
      this.statementCache = new Map()

      // Enable WAL mode for better concurrent read performance
      this.db.pragma('journal_mode = WAL')

      // Enable foreign key constraints
      this.db.pragma('foreign_keys = ON')

      // Initialize database schema
      initializeSchema(this.db)
    } catch (error) {
      throw new DatabaseError(
        `Failed to initialize database at ${dbPath}`,
        error instanceof Error ? error : undefined
      )
    }
  }

  /**
   * Get or create a cached prepared statement
   *
   * Implements prepared statement caching (DB-07) for improved performance.
   * Statements are cached by SQL string and reused across calls.
   *
   * @param sql - SQL statement to prepare
   * @returns Cached or newly prepared statement
   */
  private stmt(sql: string): Statement {
    let statement = this.statementCache.get(sql)
    if (!statement) {
      statement = this.db.prepare(sql)
      this.statementCache.set(sql, statement)
    }
    return statement
  }

  /**
   * Execute a function within a transaction
   *
   * Implements transaction support (DB-08) with automatic rollback on error.
   * Exposed for variant batch operations and testing.
   *
   * @param fn - Function to execute within transaction
   * @returns Result of the function
   * @throws TransactionError if transaction fails
   */
  runTransaction<T>(fn: () => T): T {
    try {
      const transactionFn = this.db.transaction(fn)
      return transactionFn()
    } catch (error) {
      throw new TransactionError('Transaction failed', error instanceof Error ? error : undefined)
    }
  }

  /**
   * Create a new case
   *
   * @param name - Unique case name
   * @param filePath - Original import file path
   * @param fileSize - File size in bytes
   * @returns ID of the created case
   * @throws UniqueConstraintError if case name already exists
   * @throws DatabaseError if insert fails
   */
  createCase(name: string, filePath: string, fileSize: number): number {
    try {
      const result = this.stmt(
        'INSERT INTO cases (name, file_path, file_size, variant_count, created_at) VALUES (?, ?, ?, 0, ?)'
      ).run(name, filePath, fileSize, Date.now())

      return Number(result.lastInsertRowid)
    } catch (error) {
      // Check for unique constraint violation
      if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
        throw new UniqueConstraintError('name', name)
      }
      throw new DatabaseError(
        `Failed to create case: ${name}`,
        error instanceof Error ? error : undefined
      )
    }
  }

  /**
   * Get a case by ID
   *
   * @param id - Case ID
   * @returns Case object
   * @throws NotFoundError if case does not exist
   */
  getCase(id: number): Case {
    const result = this.stmt('SELECT * FROM cases WHERE id = ?').get(id) as Case | undefined

    if (!result) {
      throw new NotFoundError('Case', id)
    }

    return result
  }

  /**
   * Get a case by name
   *
   * @param name - Case name
   * @returns Case object
   * @throws NotFoundError if case does not exist
   */
  getCaseByName(name: string): Case {
    const result = this.stmt('SELECT * FROM cases WHERE name = ?').get(name) as Case | undefined

    if (!result) {
      throw new NotFoundError('Case', name)
    }

    return result
  }

  /**
   * Get all cases ordered by creation date (newest first)
   *
   * @returns Array of all cases
   */
  getAllCases(): Case[] {
    return this.stmt('SELECT * FROM cases ORDER BY created_at DESC').all() as Case[]
  }

  /**
   * Update the variant count for a case
   *
   * @param id - Case ID
   * @param count - New variant count
   * @throws NotFoundError if case does not exist
   */
  updateCaseVariantCount(id: number, count: number): void {
    const result = this.stmt('UPDATE cases SET variant_count = ? WHERE id = ?').run(count, id)

    if (result.changes === 0) {
      throw new NotFoundError('Case', id)
    }
  }

  /**
   * Delete a case by ID
   *
   * Note: ON DELETE CASCADE in schema handles automatic variant deletion.
   *
   * @param id - Case ID
   * @throws NotFoundError if case does not exist
   */
  deleteCase(id: number): void {
    const result = this.stmt('DELETE FROM cases WHERE id = ?').run(id)

    if (result.changes === 0) {
      throw new NotFoundError('Case', id)
    }
  }

  /**
   * Close the database connection
   *
   * Should be called when the application is shutting down.
   */
  close(): void {
    this.db.close()
  }

  /**
   * Get the underlying database instance
   *
   * Exposed for testing purposes only. Use with caution.
   */
  get database(): DatabaseType {
    return this.db
  }
}
