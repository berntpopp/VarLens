import { describe, expect, it, vi } from 'vitest'

import { SqliteReadExecutor } from '../../../src/main/storage/sqlite/SqliteReadExecutor'
import type { ValidatedCaseSearchParams } from '../../../src/shared/types/ipc-schemas'

describe('SqliteReadExecutor', () => {
  const params: ValidatedCaseSearchParams = {
    limit: 25,
    offset: 0,
    sort_by: 'created_at',
    sort_order: 'desc'
  }

  it('uses the worker read pool for cases:query when a pool exists', async () => {
    const expected = { data: [], total_count: 0 }
    const dbPool = {
      run: vi.fn().mockResolvedValue(expected)
    }
    const databaseService = {
      cases: {
        queryCases: vi.fn()
      }
    }
    const executor = new SqliteReadExecutor(databaseService as never, dbPool as never)

    await expect(executor.execute({ type: 'cases:query', params })).resolves.toBe(expected)
    expect(dbPool.run).toHaveBeenCalledWith({
      type: 'cases:query',
      params: [params]
    })
    expect(databaseService.cases.queryCases).not.toHaveBeenCalled()
  })

  it('falls back to DatabaseService for cases:query when no pool exists', async () => {
    const expected = { data: [], total_count: 0 }
    const databaseService = {
      cases: {
        queryCases: vi.fn().mockReturnValue(expected)
      }
    }
    const executor = new SqliteReadExecutor(databaseService as never, null)

    await expect(executor.execute({ type: 'cases:query', params })).resolves.toBe(expected)
    expect(databaseService.cases.queryCases).toHaveBeenCalledWith(params)
  })

  it('uses the worker read pool for cases:availableBuilds when a pool exists', async () => {
    const expected = [{ build: 'GRCh38', caseCount: 2 }]
    const dbPool = {
      run: vi.fn().mockResolvedValue(expected)
    }
    const databaseService = {
      cases: {
        getAvailableGenomeBuilds: vi.fn()
      }
    }
    const executor = new SqliteReadExecutor(databaseService as never, dbPool as never)

    await expect(executor.execute({ type: 'cases:availableBuilds', params: [] })).resolves.toBe(
      expected
    )
    expect(dbPool.run).toHaveBeenCalledWith({
      type: 'cases:availableBuilds',
      params: []
    })
    expect(databaseService.cases.getAvailableGenomeBuilds).not.toHaveBeenCalled()
  })

  it('falls back to DatabaseService for cases:availableBuilds when no pool exists', async () => {
    const expected = [{ build: 'GRCh37', caseCount: 1 }]
    const databaseService = {
      cases: {
        getAvailableGenomeBuilds: vi.fn().mockReturnValue(expected)
      }
    }
    const executor = new SqliteReadExecutor(databaseService as never, null)

    await expect(executor.execute({ type: 'cases:availableBuilds', params: [] })).resolves.toBe(
      expected
    )
    expect(databaseService.cases.getAvailableGenomeBuilds).toHaveBeenCalledWith()
  })
})
