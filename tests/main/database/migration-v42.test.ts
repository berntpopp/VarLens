/**
 * Migration v42: het/hom counts of the cohort summary follow the shared
 * genotype classes (a split `1/.` is het). Stored counts predate that, so a
 * populated summary is flagged stale and the app start rebuilds it.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { DatabaseService } from '../../../src/main/database'
import { isCohortSummaryStale } from '../../../src/main/database/cohort-summary-case-removal'
import { LATEST_SQLITE_SCHEMA_VERSION, runMigrations } from '../../../src/main/database/migrations'
import { makeVariant } from '../../utils/make-variant'

describe('migration v42 — genotype classes of the cohort summary', () => {
  let service: DatabaseService

  beforeEach(() => {
    service = new DatabaseService(':memory:')
  })

  afterEach(() => service.close())

  const hetCount = (): number =>
    (
      service.database.prepare('SELECT het_count FROM cohort_variant_summary').get() as {
        het_count: number
      }
    ).het_count

  /** A v41 database whose summary was built when `1/.` was in no class. */
  function seedV41(): void {
    const caseId = service.cases.createCase('split', '/s.vcf', 1)
    service.variants.insertVariantsBatch(caseId, [makeVariant({ gt_num: '1/.' })])
    service.cohortSummary.rebuild()
    service.database.exec('UPDATE cohort_variant_summary SET het_count = 0')
    service.database.exec('PRAGMA user_version = 41')
  }

  it('is the latest schema version', () => {
    expect(LATEST_SQLITE_SCHEMA_VERSION).toBe(42)
    expect(service.database.pragma('user_version', { simple: true })).toBe(42)
  })

  it('flags a populated summary stale, so the app start rebuilds it', () => {
    seedV41()
    expect(service.needsStartupRebuild()).toBe(false)

    runMigrations(service.database)

    expect(service.database.pragma('user_version', { simple: true })).toBe(42)
    expect(isCohortSummaryStale(service.database)).toBe(true)
    expect(service.needsStartupRebuild()).toBe(true)

    service.cohortSummary.rebuild()
    expect(hetCount()).toBe(1)
    expect(service.needsStartupRebuild()).toBe(false)
  })

  it('leaves an empty summary alone', () => {
    service.cohortSummary.rebuild()
    service.database.exec('PRAGMA user_version = 41')
    runMigrations(service.database)
    expect(isCohortSummaryStale(service.database)).toBe(false)
  })

  it('does nothing when it is replayed', () => {
    seedV41()
    runMigrations(service.database)
    service.cohortSummary.rebuild()
    runMigrations(service.database)
    expect(isCohortSummaryStale(service.database)).toBe(false)
  })
})
