/**
 * Database module barrel export
 *
 * Public API for the Varlens database layer.
 */

import { DatabaseService } from './DatabaseService'
import { app } from 'electron'
import { join } from 'path'

// Singleton instance
let databaseService: DatabaseService | null = null

/**
 * Get the singleton database service instance
 *
 * Creates instance on first call using app.getPath('userData') for database location.
 * Subsequent calls return the same instance.
 *
 * @returns DatabaseService singleton instance
 */
export function getDatabaseService(): DatabaseService {
  if (!databaseService) {
    const dbPath = join(app.getPath('userData'), 'varlens.db')
    databaseService = new DatabaseService(dbPath)
  }
  return databaseService
}

/**
 * Close the database service and clear singleton
 *
 * Call during application shutdown.
 */
export function closeDatabaseService(): void {
  if (databaseService) {
    databaseService.close()
    databaseService = null
  }
}

// Service
export { DatabaseService }

// Types
export type { Case, Variant, VariantFilter, PaginationCursor, PaginatedResult } from './types'

// Errors
export { DatabaseError, NotFoundError, UniqueConstraintError, TransactionError } from './errors'
