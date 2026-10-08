/**
 * Cohort logic smoke tests — verifies module exports are intact after extraction.
 */

import { describe, it, expect, vi } from 'vitest'
import * as logic from '../../../src/main/ipc/handlers/cohort-logic'
import { registerCohortHandlers } from '../../../src/main/ipc/handlers/cohort'
import type { StorageReadTask } from '../../../src/main/storage/read-executor'
import type { StorageSession } from '../../../src/main/storage/session'
import type { ValidatedCohortSearchParams } from '../../../src/shared/types/ipc-schemas'

describe('cohort-logic exports', () => {
  it('exports expected functions', () => {
    expect(typeof logic.spawnRebuildWorker).toBe('function')
    expect(typeof logic.queryCohortVariants).toBe('function')
    expect(typeof logic.getColumnMeta).toBe('function')
    expect(typeof logic.getCohortSummary).toBe('function')
    expect(typeof logic.getCarriers).toBe('function')
    expect(typeof logic.getGeneBurden).toBe('function')
    expect(typeof logic.runGeneBurdenCompare).toBe('function')
    expect(typeof logic.cancelGeneBurdenCompare).toBe('function')
    expect(typeof logic.getSummaryStatus).toBe('function')
    expect(typeof logic.rebuildSummary).toBe('function')
    expect(typeof logic.triggerStartupRebuildIfNeeded).toBe('function')
  })
})

describe('cohort-logic PostgreSQL session routing', () => {
  function makePostgresSession(result: unknown): {
    execute: ReturnType<typeof vi.fn<[StorageReadTask], Promise<unknown>>>
    session: StorageSession
  } {
    const execute = vi.fn<[StorageReadTask], Promise<unknown>>().mockResolvedValue(result)
    const session = {
      capabilities: { backend: 'postgres' },
      getReadExecutor: () => ({ execute })
    } as unknown as StorageSession

    return { execute, session }
  }

  it('routes queryCohortVariants through the PostgreSQL read executor and converts BigInts', async () => {
    const executorResult = {
      rows: [{ id: 1n, gene: 'BRCA1' }],
      total: 1n
    }
    const { execute, session } = makePostgresSession(executorResult)
    const getDb = vi.fn()
    const getDbPool = vi.fn()
    const cohortParams = {
      page: 1,
      itemsPerPage: 25,
      sortBy: [],
      filters: {},
      active_panel_ids: [3],
      panel_padding_bp: 50
    } as unknown as ValidatedCohortSearchParams

    const result = await logic.queryCohortVariants(cohortParams, getDb, getDbPool, () => session)

    expect(execute).toHaveBeenCalledWith({
      type: 'cohort:query',
      params: [
        {
          ...cohortParams,
          genome_build: 'GRCh38'
        }
      ]
    })
    expect(result).toEqual({
      rows: [{ id: 1, gene: 'BRCA1' }],
      total: 1
    })
    expect(getDb).not.toHaveBeenCalled()
    expect(getDbPool).not.toHaveBeenCalled()
  })

  it('routes getCohortSummary through the PostgreSQL read executor', async () => {
    const { execute, session } = makePostgresSession({ total_variants: 2n })
    const getDb = vi.fn()
    const getDbPool = vi.fn()

    const result = await logic.getCohortSummary(getDb, getDbPool, () => session)

    expect(execute).toHaveBeenCalledWith({ type: 'cohort:summary', params: [] })
    expect(result).toEqual({ total_variants: 2 })
    expect(getDb).not.toHaveBeenCalled()
    expect(getDbPool).not.toHaveBeenCalled()
  })

  it('routes getColumnMeta through the PostgreSQL read executor', async () => {
    const columnMeta = [{ key: 'gene', label: 'Gene' }]
    const { execute, session } = makePostgresSession(columnMeta)
    const getDb = vi.fn()
    const getDbPool = vi.fn()

    const result = await logic.getColumnMeta(getDb, getDbPool, () => session)

    expect(execute).toHaveBeenCalledWith({ type: 'cohort:columnMeta', params: [] })
    expect(result).toBe(columnMeta)
    expect(getDb).not.toHaveBeenCalled()
    expect(getDbPool).not.toHaveBeenCalled()
  })

  it('routes getCarriers through the PostgreSQL read executor', async () => {
    const { execute, session } = makePostgresSession([{ case_id: 7n }])
    const getDb = vi.fn()
    const getDbPool = vi.fn()
    const variant = {
      chr: 'chr1',
      pos: 123,
      ref: 'A',
      alt: 'T',
      variant_type: 'snv',
      genome_build: 'GRCh38'
    }

    const result = await logic.getCarriers(variant, getDb, getDbPool, () => session)

    expect(execute).toHaveBeenCalledWith({ type: 'cohort:carriers', params: [variant] })
    expect(result).toEqual([{ case_id: 7 }])
    expect(getDb).not.toHaveBeenCalled()
    expect(getDbPool).not.toHaveBeenCalled()
  })

  it('routes getGeneBurden through the PostgreSQL read executor', async () => {
    const geneBurden = [{ gene: 'BRCA1', carriers: 4 }]
    const { execute, session } = makePostgresSession(geneBurden)
    const getDb = vi.fn()
    const getDbPool = vi.fn()

    const result = await logic.getGeneBurden(getDb, getDbPool, () => session)

    expect(execute).toHaveBeenCalledWith({ type: 'cohort:geneBurden', params: [] })
    expect(result).toBe(geneBurden)
    expect(getDb).not.toHaveBeenCalled()
    expect(getDbPool).not.toHaveBeenCalled()
  })
})

describe('cohort IPC PostgreSQL session routing', () => {
  it('passes the current storage session into cohort logic handlers', async () => {
    const execute = vi.fn<[StorageReadTask], Promise<unknown>>().mockResolvedValue({
      data: [],
      total_count: 0
    })
    const registered = new Map<string, (...args: unknown[]) => Promise<unknown>>()
    const ipcMain = {
      handle: vi.fn((channel: string, handler: (...args: unknown[]) => Promise<unknown>) => {
        registered.set(channel, handler)
      })
    }
    registerCohortHandlers({
      ipcMain: ipcMain as never,
      getDb: (() => {
        throw new Error('getDb should not be called for postgres cohort IPC')
      }) as never,
      getDbPool: (() => {
        throw new Error('getDbPool should not be called for postgres cohort IPC')
      }) as never,
      getDbManager: (() => ({
        getCurrentSession: () =>
          ({
            capabilities: { backend: 'postgres' },
            getReadExecutor: () => ({ execute })
          }) as unknown as StorageSession
      })) as never
    })

    const result = await registered.get('cohort:variants')!(undefined, { limit: 25, offset: 0 })

    expect(result).toEqual({ data: [], total_count: 0 })
    expect(execute).toHaveBeenCalledWith({
      type: 'cohort:query',
      params: [{ limit: 25, offset: 0, genome_build: 'GRCh38' }]
    })
  })
})

describe('cohort:carriers IPC validation (#503)', () => {
  const VARIANT = {
    chr: 'chr1',
    pos: 100,
    ref: 'A',
    alt: 'T',
    variant_type: 'snv',
    genome_build: 'GRCh38'
  }

  function registerCarriers(): {
    execute: ReturnType<typeof vi.fn<[StorageReadTask], Promise<unknown>>>
    carriers: (...args: unknown[]) => Promise<unknown>
  } {
    const execute = vi.fn<[StorageReadTask], Promise<unknown>>().mockResolvedValue([])
    const registered = new Map<string, (...args: unknown[]) => Promise<unknown>>()
    registerCohortHandlers({
      ipcMain: {
        handle: (channel: string, handler: (...args: unknown[]) => Promise<unknown>) => {
          registered.set(channel, handler)
        }
      } as never,
      getDb: (() => {
        throw new Error('getDb should not be called for postgres cohort IPC')
      }) as never,
      getDbPool: (() => {
        throw new Error('getDbPool should not be called for postgres cohort IPC')
      }) as never,
      getDbManager: (() => ({
        getCurrentSession: () =>
          ({
            capabilities: { backend: 'postgres' },
            getReadExecutor: () => ({ execute })
          }) as unknown as StorageSession
      })) as never
    })
    return { execute, carriers: registered.get('cohort:carriers')! }
  }

  it('passes the six identity fields to storage', async () => {
    const { execute, carriers } = registerCarriers()

    await expect(carriers(undefined, { ...VARIANT, carrier_count: 2 })).resolves.toEqual([])

    expect(execute).toHaveBeenCalledWith({ type: 'cohort:carriers', params: [VARIANT] })
  })

  it.each([
    ['no genome build', [{ ...VARIANT, genome_build: undefined }]],
    ['no variant type', [{ ...VARIANT, variant_type: undefined }]],
    ['an empty genome build', [{ ...VARIANT, genome_build: '' }]],
    ['an empty variant type', [{ ...VARIANT, variant_type: '' }]],
    ['the old four positional arguments', ['chr1', 100, 'A', 'T']]
  ])('rejects a request with %s before it reaches storage', async (_label, args) => {
    const { execute, carriers } = registerCarriers()

    await expect(carriers(undefined, ...args)).resolves.toMatchObject({
      message: 'Invalid carrier query parameters'
    })

    expect(execute).not.toHaveBeenCalled()
  })
})
