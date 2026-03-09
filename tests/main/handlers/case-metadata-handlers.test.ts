/**
 * Case Metadata IPC handler integration tests
 *
 * Tests metadata repository methods with real SQLite backend.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { DatabaseService } from '../../../src/main/database/DatabaseService'

describe('case-metadata IPC handlers', () => {
  let db: DatabaseService
  let caseId: number

  // Helper to insert a case
  const insertCase = (name: string): number => {
    const result = db.database
      .prepare(
        'INSERT INTO cases (name, file_path, file_size, variant_count, created_at) VALUES (?, ?, ?, ?, ?)'
      )
      .run(name, `/test/path/${name}.json`, 1000, 0, Date.now())
    return result.lastInsertRowid as number
  }

  beforeEach(() => {
    db = new DatabaseService(':memory:')
    caseId = insertCase('Test Case')
  })

  afterEach(() => {
    db.close()
  })

  // ============================================================
  // case-metadata:get / case-metadata:upsert
  // ============================================================

  describe('getCaseMetadata (case-metadata:get)', () => {
    it('returns null when no metadata exists', () => {
      const result = db.metadata.getCaseMetadata(caseId)
      expect(result).toBeNull()
    })

    it('returns metadata after it has been upserted', () => {
      db.metadata.upsertCaseMetadata(caseId, { affected_status: 'affected', sex: 'male' })

      const result = db.metadata.getCaseMetadata(caseId)
      expect(result).not.toBeNull()
      expect(result!.affected_status).toBe('affected')
      expect(result!.sex).toBe('male')
      expect(result!.case_id).toBe(caseId)
    })
  })

  describe('upsertCaseMetadata (case-metadata:upsert)', () => {
    it('creates metadata for a new case', () => {
      const result = db.metadata.upsertCaseMetadata(caseId, {
        affected_status: 'unaffected',
        sex: 'female',
        notes: 'Test notes'
      })

      expect(result.case_id).toBe(caseId)
      expect(result.affected_status).toBe('unaffected')
      expect(result.sex).toBe('female')
      expect(result.notes).toBe('Test notes')
      expect(result.created_at).toBeGreaterThan(0)
    })

    it('updates existing metadata', () => {
      db.metadata.upsertCaseMetadata(caseId, { affected_status: 'affected' })

      const updated = db.metadata.upsertCaseMetadata(caseId, { affected_status: 'unaffected' })

      expect(updated.affected_status).toBe('unaffected')
    })

    it('preserves fields not included in update', () => {
      db.metadata.upsertCaseMetadata(caseId, {
        affected_status: 'affected',
        sex: 'male'
      })

      // Update only notes
      const updated = db.metadata.upsertCaseMetadata(caseId, { notes: 'New note' })

      expect(updated.notes).toBe('New note')
      // sex was not included in the update, should remain unchanged
      expect(updated.sex).toBe('male')
    })
  })

  // ============================================================
  // HPO Terms
  // ============================================================

  describe('getCaseHpoTerms (case-metadata:getHpoTerms)', () => {
    it('returns empty array when no HPO terms exist', () => {
      const terms = db.metadata.getCaseHpoTerms(caseId)
      expect(terms).toEqual([])
    })

    it('returns all HPO terms for a case ordered by hpo_id', () => {
      db.metadata.assignCaseHpoTerm(caseId, 'HP:0001250', 'Seizure')
      db.metadata.assignCaseHpoTerm(caseId, 'HP:0000252', 'Microcephaly')

      const terms = db.metadata.getCaseHpoTerms(caseId)
      expect(terms.length).toBe(2)
      expect(terms[0].hpo_id).toBe('HP:0000252')
      expect(terms[1].hpo_id).toBe('HP:0001250')
    })
  })

  describe('assignCaseHpoTerm (case-metadata:assignHpoTerm)', () => {
    it('assigns an HPO term to a case', () => {
      const term = db.metadata.assignCaseHpoTerm(caseId, 'HP:0001250', 'Seizure')

      expect(term.case_id).toBe(caseId)
      expect(term.hpo_id).toBe('HP:0001250')
      expect(term.hpo_label).toBe('Seizure')
      expect(term.created_at).toBeGreaterThan(0)
    })

    it('updates label when assigning same HPO term twice', () => {
      db.metadata.assignCaseHpoTerm(caseId, 'HP:0001250', 'Seizure')
      const updated = db.metadata.assignCaseHpoTerm(caseId, 'HP:0001250', 'Seizures')

      expect(updated.hpo_label).toBe('Seizures')

      const terms = db.metadata.getCaseHpoTerms(caseId)
      expect(terms.length).toBe(1)
    })
  })

  describe('removeCaseHpoTerm (case-metadata:removeHpoTerm)', () => {
    it('removes an HPO term from a case', () => {
      db.metadata.assignCaseHpoTerm(caseId, 'HP:0001250', 'Seizure')
      expect(db.metadata.getCaseHpoTerms(caseId).length).toBe(1)

      db.metadata.removeCaseHpoTerm(caseId, 'HP:0001250')

      expect(db.metadata.getCaseHpoTerms(caseId).length).toBe(0)
    })

    it('does not error when removing a non-existent HPO term', () => {
      expect(() => db.metadata.removeCaseHpoTerm(caseId, 'HP:9999999')).not.toThrow()
    })
  })

  // ============================================================
  // Cohorts
  // ============================================================

  describe('listCohortGroups (case-metadata:listCohorts)', () => {
    it('returns empty array when no cohorts exist', () => {
      const cohorts = db.metadata.listCohortGroups()
      expect(cohorts).toEqual([])
    })

    it('lists cohorts ordered by name', () => {
      db.metadata.createCohortGroup('Zebra cohort')
      db.metadata.createCohortGroup('Alpha cohort')

      const cohorts = db.metadata.listCohortGroups()
      expect(cohorts.length).toBe(2)
      expect(cohorts[0].name).toBe('Alpha cohort')
      expect(cohorts[1].name).toBe('Zebra cohort')
    })
  })

  describe('createCohortGroup (case-metadata:createCohort)', () => {
    it('creates a cohort group and returns it', () => {
      const cohort = db.metadata.createCohortGroup('Test Cohort', 'A test cohort')

      expect(cohort).toHaveProperty('id')
      expect(cohort.name).toBe('Test Cohort')
      expect(cohort.description).toBe('A test cohort')
      expect(cohort.created_at).toBeGreaterThan(0)
    })

    it('creates a cohort without description', () => {
      const cohort = db.metadata.createCohortGroup('No Desc')

      expect(cohort.name).toBe('No Desc')
      expect(cohort.description).toBeNull()
    })

    it('rejects duplicate cohort names', () => {
      db.metadata.createCohortGroup('Unique')

      expect(() => db.metadata.createCohortGroup('Unique')).toThrow()
    })
  })

  describe('cohort-case assignment', () => {
    it('assigns a case to a cohort and retrieves it', () => {
      const cohort = db.metadata.createCohortGroup('My Cohort')

      db.metadata.assignCaseCohort(caseId, cohort.id)

      const caseCohorts = db.metadata.getCaseCohorts(caseId)
      expect(caseCohorts.length).toBe(1)
      expect(caseCohorts[0].name).toBe('My Cohort')
    })

    it('does not duplicate when assigning same cohort twice', () => {
      const cohort = db.metadata.createCohortGroup('My Cohort')

      db.metadata.assignCaseCohort(caseId, cohort.id)
      db.metadata.assignCaseCohort(caseId, cohort.id)

      const caseCohorts = db.metadata.getCaseCohorts(caseId)
      expect(caseCohorts.length).toBe(1)
    })

    it('removes a case from a cohort', () => {
      const cohort = db.metadata.createCohortGroup('My Cohort')
      db.metadata.assignCaseCohort(caseId, cohort.id)
      expect(db.metadata.getCaseCohorts(caseId).length).toBe(1)

      db.metadata.removeCaseCohort(caseId, cohort.id)

      expect(db.metadata.getCaseCohorts(caseId).length).toBe(0)
    })

    it('replaces all cohort assignments with setCaseCohorts', () => {
      const cohort1 = db.metadata.createCohortGroup('Old Cohort')
      const cohort2 = db.metadata.createCohortGroup('New Cohort 1')
      const cohort3 = db.metadata.createCohortGroup('New Cohort 2')

      db.metadata.assignCaseCohort(caseId, cohort1.id)

      db.metadata.setCaseCohorts(caseId, [cohort2.id, cohort3.id])

      const caseCohorts = db.metadata.getCaseCohorts(caseId)
      expect(caseCohorts.length).toBe(2)
      const names = caseCohorts.map((c) => c.name)
      expect(names).toContain('New Cohort 1')
      expect(names).toContain('New Cohort 2')
      expect(names).not.toContain('Old Cohort')
    })
  })

  // ============================================================
  // getFullMetadata (case-metadata:getFullMetadata)
  // ============================================================

  describe('getFullMetadata (case-metadata:getFullMetadata)', () => {
    it('returns all metadata sections for a case with no data', () => {
      const full = {
        metadata: db.metadata.getCaseMetadata(caseId),
        cohorts: db.metadata.getCaseCohorts(caseId),
        hpoTerms: db.metadata.getCaseHpoTerms(caseId),
        comments: db.metadata.listCaseComments(caseId),
        metrics: db.metadata.listCaseMetrics(caseId),
        dataInfo: db.metadata.getCaseDataInfo(caseId),
        externalIds: db.metadata.listCaseExternalIds(caseId)
      }

      expect(full.metadata).toBeNull()
      expect(full.cohorts).toEqual([])
      expect(full.hpoTerms).toEqual([])
      expect(full.comments).toEqual([])
      expect(full.metrics).toEqual([])
      expect(full.dataInfo).toBeNull()
      expect(full.externalIds).toEqual([])
    })

    it('returns populated metadata sections after data is added', () => {
      // Add metadata
      db.metadata.upsertCaseMetadata(caseId, { affected_status: 'affected', sex: 'male' })

      // Add HPO terms
      db.metadata.assignCaseHpoTerm(caseId, 'HP:0001250', 'Seizure')

      // Add cohort
      const cohort = db.metadata.createCohortGroup('Epilepsy')
      db.metadata.assignCaseCohort(caseId, cohort.id)

      const full = {
        metadata: db.metadata.getCaseMetadata(caseId),
        cohorts: db.metadata.getCaseCohorts(caseId),
        hpoTerms: db.metadata.getCaseHpoTerms(caseId),
        comments: db.metadata.listCaseComments(caseId),
        metrics: db.metadata.listCaseMetrics(caseId),
        dataInfo: db.metadata.getCaseDataInfo(caseId),
        externalIds: db.metadata.listCaseExternalIds(caseId)
      }

      expect(full.metadata).not.toBeNull()
      expect(full.metadata!.affected_status).toBe('affected')
      expect(full.cohorts.length).toBe(1)
      expect(full.cohorts[0].name).toBe('Epilepsy')
      expect(full.hpoTerms.length).toBe(1)
      expect(full.hpoTerms[0].hpo_id).toBe('HP:0001250')
      expect(full.comments).toEqual([])
      expect(full.metrics).toEqual([])
    })
  })
})
