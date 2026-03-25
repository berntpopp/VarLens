/**
 * Tests for CaseRepository.queryCases() - paginated case query with JOINs
 *
 * Verifies that the single-query approach returns correct pagination,
 * search filtering, cohort filtering, sorting, and metadata enrichment.
 *
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3-multiple-ciphers'
import { CaseRepository } from '../../../src/main/database/CaseRepository'
import { initializeSchema } from '../../../src/main/database/schema'
import { runMigrations } from '../../../src/main/database/migrations'
import { createKysely } from '../../../src/main/database/kysely'

describe('CaseRepository.queryCases', () => {
  let db: Database.Database
  let caseRepo: CaseRepository

  /** Insert a case and return its ID */
  const insertCase = (name: string, variantCount = 0, createdAt?: number): number => {
    const stmt = db.prepare(
      'INSERT INTO cases (name, file_path, file_size, variant_count, created_at) VALUES (?, ?, ?, ?, ?)'
    )
    const result = stmt.run(name, `/test/${name}.json`, 1000, variantCount, createdAt ?? Date.now())
    return result.lastInsertRowid as number
  }

  /** Insert case_metadata for a case */
  const insertMetadata = (
    caseId: number,
    affectedStatus: string | null,
    sex: string | null
  ): void => {
    db.prepare(
      'INSERT INTO case_metadata (case_id, affected_status, sex, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
    ).run(caseId, affectedStatus, sex, Date.now(), Date.now())
  }

  /** Create a cohort group and return its ID */
  const createCohort = (name: string): number => {
    const result = db
      .prepare('INSERT INTO cohort_groups (name, created_at) VALUES (?, ?)')
      .run(name, Date.now())
    return result.lastInsertRowid as number
  }

  /** Link a case to a cohort */
  const linkCaseToCohort = (caseId: number, cohortId: number): void => {
    db.prepare('INSERT INTO case_cohort_links (case_id, cohort_id) VALUES (?, ?)').run(
      caseId,
      cohortId
    )
  }

  beforeEach(() => {
    db = new Database(':memory:')
    initializeSchema(db)
    runMigrations(db)
    const kysely = createKysely(db)
    caseRepo = new CaseRepository(db, kysely)
  })

  afterEach(() => {
    db.close()
  })

  describe('pagination', () => {
    it('returns paginated results with correct total_count', () => {
      // Insert 12 cases
      for (let i = 1; i <= 12; i++) {
        insertCase(`Case ${String(i).padStart(2, '0')}`, i * 10, 1000 + i)
      }

      const page1 = caseRepo.queryCases({ limit: 5, offset: 0 })
      expect(page1.data).toHaveLength(5)
      expect(page1.total_count).toBe(12)

      const page2 = caseRepo.queryCases({ limit: 5, offset: 5 })
      expect(page2.data).toHaveLength(5)
      expect(page2.total_count).toBe(12)

      const page3 = caseRepo.queryCases({ limit: 5, offset: 10 })
      expect(page3.data).toHaveLength(2)
      expect(page3.total_count).toBe(12)
    })

    it('offset pagination returns correct slices', () => {
      for (let i = 1; i <= 5; i++) {
        insertCase(`Case ${i}`, 0, 1000 + i)
      }

      // Default sort is created_at DESC, so Case 5 (created_at=1005) first
      const result = caseRepo.queryCases({ limit: 2, offset: 2 })
      expect(result.data).toHaveLength(2)
      // Cases 5,4,3,2,1 in desc order; offset 2 gives Case 3, Case 2
      expect(result.data[0].name).toBe('Case 3')
      expect(result.data[1].name).toBe('Case 2')
    })
  })

  describe('search filter', () => {
    it('LIKE filter matches case names', () => {
      insertCase('Patient Alpha')
      insertCase('Patient Beta')
      insertCase('Control Gamma')

      const result = caseRepo.queryCases({ limit: 50, search_term: 'Patient' })
      expect(result.data).toHaveLength(2)
      expect(result.total_count).toBe(2)
      expect(result.data.every((c) => c.name.includes('Patient'))).toBe(true)
    })

    it('search is case-insensitive (SQLite LIKE default)', () => {
      insertCase('Patient Alpha')
      insertCase('Control Beta')

      const result = caseRepo.queryCases({ limit: 50, search_term: 'patient' })
      expect(result.data).toHaveLength(1)
      expect(result.data[0].name).toBe('Patient Alpha')
    })
  })

  describe('cohort filter', () => {
    it('filters by single cohort', () => {
      const c1 = insertCase('In Cohort')
      insertCase('Not In Cohort')
      const cohortId = createCohort('Test Cohort')
      linkCaseToCohort(c1, cohortId)

      const result = caseRepo.queryCases({ limit: 50, cohort_ids: [cohortId] })
      expect(result.data).toHaveLength(1)
      expect(result.data[0].name).toBe('In Cohort')
      expect(result.total_count).toBe(1)
    })

    it('multi-cohort filter returns cases in any of the specified cohorts', () => {
      const c1 = insertCase('Case A')
      const c2 = insertCase('Case B')
      insertCase('Case C')
      const cohort1 = createCohort('Cohort 1')
      const cohort2 = createCohort('Cohort 2')
      linkCaseToCohort(c1, cohort1)
      linkCaseToCohort(c2, cohort2)

      const result = caseRepo.queryCases({ limit: 50, cohort_ids: [cohort1, cohort2] })
      expect(result.data).toHaveLength(2)
      expect(result.total_count).toBe(2)
      const names = result.data.map((c) => c.name).sort()
      expect(names).toEqual(['Case A', 'Case B'])
    })
  })

  describe('sorting', () => {
    it('sorts by name ascending', () => {
      insertCase('Zeta')
      insertCase('Alpha')
      insertCase('Mu')

      const result = caseRepo.queryCases({ limit: 50, sort_by: 'name', sort_order: 'asc' })
      expect(result.data.map((c) => c.name)).toEqual(['Alpha', 'Mu', 'Zeta'])
    })

    it('sorts by name descending', () => {
      insertCase('Zeta')
      insertCase('Alpha')
      insertCase('Mu')

      const result = caseRepo.queryCases({ limit: 50, sort_by: 'name', sort_order: 'desc' })
      expect(result.data.map((c) => c.name)).toEqual(['Zeta', 'Mu', 'Alpha'])
    })

    it('sorts by variant_count ascending', () => {
      insertCase('Low', 10)
      insertCase('High', 1000)
      insertCase('Mid', 500)

      const result = caseRepo.queryCases({
        limit: 50,
        sort_by: 'variant_count',
        sort_order: 'asc'
      })
      expect(result.data.map((c) => c.variant_count)).toEqual([10, 500, 1000])
    })

    it('sorts by created_at descending by default', () => {
      insertCase('Old', 0, 1000)
      insertCase('New', 0, 3000)
      insertCase('Mid', 0, 2000)

      const result = caseRepo.queryCases({ limit: 50 })
      expect(result.data.map((c) => c.name)).toEqual(['New', 'Mid', 'Old'])
    })

    it('ignores unknown sort_by values (falls back to created_at)', () => {
      insertCase('Old', 0, 1000)
      insertCase('New', 0, 3000)

      const result = caseRepo.queryCases({ limit: 50, sort_by: 'DROP TABLE cases' as 'name' })
      // Falls back to created_at DESC
      expect(result.data[0].name).toBe('New')
    })
  })

  describe('count optimization', () => {
    it('_count_needed: false skips count query (total_count = 0)', () => {
      for (let i = 1; i <= 5; i++) {
        insertCase(`Case ${i}`)
      }

      const result = caseRepo.queryCases({ limit: 50, _count_needed: false })
      expect(result.data).toHaveLength(5)
      expect(result.total_count).toBe(0)
    })

    it('count is included by default', () => {
      for (let i = 1; i <= 5; i++) {
        insertCase(`Case ${i}`)
      }

      const result = caseRepo.queryCases({ limit: 50 })
      expect(result.total_count).toBe(5)
    })
  })

  describe('cohort arrays', () => {
    it('populates cohort_names and cohort_ids from GROUP_CONCAT', () => {
      const caseId = insertCase('Multi-Cohort Case')
      const cohort1 = createCohort('Cardio')
      const cohort2 = createCohort('Neuro')
      linkCaseToCohort(caseId, cohort1)
      linkCaseToCohort(caseId, cohort2)

      const result = caseRepo.queryCases({ limit: 50 })
      expect(result.data).toHaveLength(1)
      const caseRow = result.data[0]
      expect(caseRow.cohort_names.sort()).toEqual(['Cardio', 'Neuro'])
      expect(caseRow.cohort_ids.sort()).toEqual([cohort1, cohort2].sort())
    })

    it('returns empty arrays for cases with no cohorts', () => {
      insertCase('Lone Case')

      const result = caseRepo.queryCases({ limit: 50 })
      expect(result.data[0].cohort_names).toEqual([])
      expect(result.data[0].cohort_ids).toEqual([])
    })
  })

  describe('metadata', () => {
    it('includes affected_status and sex from case_metadata', () => {
      const caseId = insertCase('Metadata Case')
      insertMetadata(caseId, 'affected', 'female')

      const result = caseRepo.queryCases({ limit: 50 })
      expect(result.data[0].affected_status).toBe('affected')
      expect(result.data[0].sex).toBe('female')
    })

    it('returns null for affected_status/sex when no metadata exists', () => {
      insertCase('No Metadata Case')

      const result = caseRepo.queryCases({ limit: 50 })
      expect(result.data[0].affected_status).toBeNull()
      expect(result.data[0].sex).toBeNull()
    })
  })

  describe('combined filters', () => {
    it('search + cohort filter works together', () => {
      const c1 = insertCase('Patient Alpha')
      const c2 = insertCase('Patient Beta')
      insertCase('Control Gamma')
      const cohortId = createCohort('Study')
      linkCaseToCohort(c1, cohortId)
      linkCaseToCohort(c2, cohortId)

      const result = caseRepo.queryCases({
        limit: 50,
        search_term: 'Alpha',
        cohort_ids: [cohortId]
      })
      expect(result.data).toHaveLength(1)
      expect(result.data[0].name).toBe('Patient Alpha')
      expect(result.total_count).toBe(1)
    })
  })
})
