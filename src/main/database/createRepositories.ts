/**
 * Repository factory — shared between DatabaseService (main thread) and db-worker (pool).
 *
 * Given a raw better-sqlite3 connection, creates a Kysely instance and instantiates
 * every repository / service. The returned object is typed so workers and the main
 * thread share the same API surface.
 */

import type { Database as DatabaseType } from 'better-sqlite3-multiple-ciphers'
import { createKysely } from './kysely'
import { CaseRepository } from './CaseRepository'
import { VariantRepository } from './VariantRepository'
import { TranscriptRepository } from './TranscriptRepository'
import { AnnotationRepository } from './AnnotationRepository'
import { MetadataRepository } from './MetadataRepository'
import { TagRepository } from './TagRepository'
import { DatabaseOverviewService } from './DatabaseOverviewService'
import { AuditLogRepository } from './AuditLogRepository'
import { GeneListRepository } from './GeneListRepository'
import { AuthService } from '../services/auth'
import { CohortSummaryService } from './CohortSummaryService'
import { FilterPresetRepository } from './FilterPresetRepository'
import { CohortService } from './cohort'

export function createRepositories(db: DatabaseType) {
  const kysely = createKysely(db)

  const cases = new CaseRepository(db, kysely)
  const transcripts = new TranscriptRepository(db, kysely)
  const annotations = new AnnotationRepository(db, kysely)
  const metadata = new MetadataRepository(db, kysely)
  const tags = new TagRepository(db, kysely)
  const variants = new VariantRepository(db, kysely, cases)
  const overview = new DatabaseOverviewService(db, kysely)
  const auditLog = new AuditLogRepository(db, kysely)
  const geneLists = new GeneListRepository(db, kysely)
  const auth = new AuthService(db)
  const cohortSummary = new CohortSummaryService(db)
  const filterPresets = new FilterPresetRepository(db, kysely)
  const cohort = new CohortService(db)

  return {
    kysely,
    cases,
    variants,
    transcripts,
    annotations,
    metadata,
    tags,
    overview,
    auditLog,
    geneLists,
    auth,
    cohortSummary,
    filterPresets,
    cohort
  }
}

export type Repositories = ReturnType<typeof createRepositories>
