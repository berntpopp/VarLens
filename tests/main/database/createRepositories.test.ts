/**
 * Unit tests for createRepositories factory
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { DatabaseService } from '../../../src/main/database'
import { createRepositories } from '../../../src/main/database/createRepositories'

describe('createRepositories', () => {
  let service: DatabaseService

  beforeEach(() => {
    service = new DatabaseService(':memory:')
  })

  afterEach(() => {
    service.close()
  })

  it('returns all expected repository keys', () => {
    const repos = createRepositories(service.database)
    const keys = Object.keys(repos).sort()

    expect(keys).toEqual(
      [
        'annotations',
        'auditLog',
        'auth',
        'cases',
        'cohort',
        'cohortSummary',
        'filterPresets',
        'geneLists',
        'kysely',
        'metadata',
        'overview',
        'tags',
        'transcripts',
        'variants'
      ].sort()
    )
  })

  it('creates functional repository instances', () => {
    const repos = createRepositories(service.database)

    // Smoke-test: calling a read method should not throw
    const cases = repos.cases.getAllCases()
    expect(Array.isArray(cases)).toBe(true)
    expect(cases).toHaveLength(0)
  })

  it('CohortService works from factory', () => {
    const repos = createRepositories(service.database)

    // getCohortSummary reads from summary tables — should return zeros on empty DB
    const summary = repos.cohort.getCohortSummary()
    expect(summary).toBeDefined()
    expect(summary.total_cases).toBe(0)
  })

  it('DatabaseService uses factory internally', () => {
    // Verify that DatabaseService getters still work after refactor
    const cases = service.cases.getAllCases()
    expect(Array.isArray(cases)).toBe(true)

    const status = service.cohortSummary.getStatus()
    expect(status).toBeDefined()
  })
})
