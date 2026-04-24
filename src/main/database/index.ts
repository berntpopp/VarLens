/**
 * Database module barrel export
 *
 * Public API for the Varlens database layer.
 * Now uses DatabaseManager for lifecycle management instead of singleton DatabaseService.
 */

import { DatabaseManager } from '../services/DatabaseManager'
import { RecentDatabasesService } from '../services/RecentDatabasesService'
import { app } from 'electron'
import { join } from 'path'
import { openConfiguredDatabase } from './startup'

// Singleton instance of DatabaseManager
let databaseManager: DatabaseManager | null = null

/**
 * Initialize the DatabaseManager singleton
 *
 * Creates manager and opens default database at userData/varlens.db.
 * Should be called once during app initialization.
 *
 * @returns DatabaseManager singleton instance
 * @throws DatabaseError if the default database cannot be opened
 */
export async function initDatabaseManager(): Promise<DatabaseManager> {
  if (!databaseManager) {
    const settingsPath = join(app.getPath('userData'), 'varlens-settings.json')
    const recentDatabases = new RecentDatabasesService(settingsPath)
    databaseManager = new DatabaseManager(recentDatabases)

    await openConfiguredDatabase(databaseManager, {
      env: process.env,
      userDataPath: app.getPath('userData')
    })
  }
  return databaseManager
}

/**
 * Initialize the DatabaseManager singleton WITHOUT opening a database
 *
 * Used as a fallback when the default database fails to open (e.g., corrupt/locked).
 * The app starts with no active database — the user can pick or create one from the UI.
 *
 * @returns DatabaseManager singleton instance (with no active database)
 */
export function initDatabaseManagerSafe(): DatabaseManager {
  if (!databaseManager) {
    const settingsPath = join(app.getPath('userData'), 'varlens-settings.json')
    const recentDatabases = new RecentDatabasesService(settingsPath)
    databaseManager = new DatabaseManager(recentDatabases)
  }
  return databaseManager
}

/**
 * Get the DatabaseManager singleton
 *
 * @returns DatabaseManager singleton instance
 * @throws Error if manager not initialized
 */
export function getDatabaseManager(): DatabaseManager {
  if (!databaseManager) {
    throw new Error('DatabaseManager not initialized. Call initDatabaseManager() first.')
  }
  return databaseManager
}

/**
 * Get the current database service (backward compatibility)
 *
 * This function preserves backward compatibility with existing IPC handlers
 * that call getDatabaseService(). They can continue working without changes.
 *
 * @returns Current DatabaseService instance
 * @throws Error if no database is currently open
 */
export function getDatabaseService() {
  return getDatabaseManager().getCurrent()
}

/**
 * Close the database manager and clear singleton
 *
 * Call during application shutdown.
 */
export async function closeDatabaseManager(): Promise<void> {
  if (databaseManager) {
    await databaseManager.close()
    databaseManager = null
  }
}

// Service
export { DatabaseService } from './DatabaseService'
export { DatabaseManager }
export { RecentDatabasesService }
// DbPool intentionally NOT exported from barrel — import directly from './DbPool'
// to avoid pulling piscina into test contexts that don't need it
export { createRepositories, type Repositories } from './createRepositories'

// Repositories
export { BaseRepository } from './BaseRepository'
export { CaseRepository } from './CaseRepository'
export { VariantRepository } from './VariantRepository'
export { TranscriptRepository } from './TranscriptRepository'
export { AnnotationRepository } from './AnnotationRepository'
export { MetadataRepository } from './MetadataRepository'
export { TagRepository } from './TagRepository'
export { DatabaseOverviewService } from './DatabaseOverviewService'
export { AnalysisGroupRepository } from './AnalysisGroupRepository'

// Types
export type {
  Case,
  Variant,
  VariantFilter,
  PaginatedResult,
  AcmgClassification,
  AcmgEvidence,
  VariantAnnotation,
  CaseVariantAnnotation,
  CaseMetadata,
  CohortGroup,
  CaseCohortLink,
  ApiCache,
  Tag,
  VariantTag,
  CaseHpoTerm,
  CaseComment,
  CommentCategory,
  MetricDefinition,
  CaseMetric,
  CaseMetricWithDefinition,
  AnalysisGroup,
  AnalysisGroupMember,
  AnalysisGroupWithMembers,
  AnalysisGroupRole,
  AffectedStatusValue
} from './types'

// Errors
export {
  DatabaseError,
  NotFoundError,
  UniqueConstraintError,
  TransactionError,
  WrongPasswordError,
  EncryptionError
} from './errors'
