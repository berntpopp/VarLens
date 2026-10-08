import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ErrorCode } from '../../../../src/shared/types/errors'

describe('cohort preload domain behavior', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.resetModules()
    vi.doUnmock('electron')
    delete (process as typeof process & { contextIsolated?: boolean }).contextIsolated
  })

  it('forwards all cohort domain channels without unwrapping in createCohortApi', async () => {
    const invoke = vi
      .fn()
      .mockResolvedValueOnce({ data: [], total_count: 0 })
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ variants: [], total_count: 0, has_x_chromosome: false })
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ is_stale: false, last_rebuilt_at: 1000000 })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({
        code: ErrorCode.DB_ERROR,
        message: 'association failed',
        userMessage: 'Could not run association'
      })
      .mockResolvedValueOnce(undefined)

    vi.doMock('electron', () => ({
      ipcRenderer: { invoke }
    }))

    const { createCohortApi } = await import('../../../../src/preload/domains/cohort')
    const api = createCohortApi()

    await expect(api.getVariants({ limit: 50, offset: 0 })).resolves.toEqual({
      data: [],
      total_count: 0
    })
    await expect(api.getColumnMeta()).resolves.toEqual([])
    await expect(api.getSummary()).resolves.toEqual({
      variants: [],
      total_count: 0,
      has_x_chromosome: false
    })
    await expect(api.getCarriers({ chr: 'chr22', pos: 1000, ref: 'A', alt: 'T', variant_type: 'snv', genome_build: 'GRCh38' })).resolves.toEqual([])
    await expect(api.getGeneBurden()).resolves.toEqual([])
    await expect(api.getSummaryStatus()).resolves.toEqual({
      is_stale: false,
      last_rebuilt_at: 1000000
    })
    await expect(api.rebuildSummary()).resolves.toBeUndefined()
    await expect(api.runAssociation({})).resolves.toMatchObject({
      code: ErrorCode.DB_ERROR,
      message: 'association failed'
    })
    await expect(api.cancelAssociation()).resolves.toBeUndefined()

    expect(invoke).toHaveBeenNthCalledWith(1, 'cohort:variants', { limit: 50, offset: 0 })
    expect(invoke).toHaveBeenNthCalledWith(2, 'cohort:columnMeta')
    expect(invoke).toHaveBeenNthCalledWith(3, 'cohort:summary')
    expect(invoke).toHaveBeenNthCalledWith(4, 'cohort:carriers', { chr: 'chr22', pos: 1000, ref: 'A', alt: 'T', variant_type: 'snv', genome_build: 'GRCh38' })
    expect(invoke).toHaveBeenNthCalledWith(5, 'cohort:geneBurden')
    expect(invoke).toHaveBeenNthCalledWith(6, 'cohort:summaryStatus')
    expect(invoke).toHaveBeenNthCalledWith(7, 'cohort:rebuildSummary')
    expect(invoke).toHaveBeenNthCalledWith(8, 'cohort:geneBurdenCompare', {})
    expect(invoke).toHaveBeenNthCalledWith(9, 'cohort:geneBurdenCancel')
  })

  it('preload index preserves cohort transport results when exposing window.api', async () => {
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'cohort:variants' || channel === 'cohort:geneBurdenCompare') {
        return {
          code: ErrorCode.DB_ERROR,
          message: `${channel} failed`,
          userMessage: `Could not run ${channel}`
        }
      }
      if (channel === 'cohort:rebuildSummary' || channel === 'cohort:geneBurdenCancel') {
        return undefined
      }
      if (channel === 'cohort:summary') {
        return { variants: [], total_count: 0, has_x_chromosome: false }
      }
      if (channel === 'cohort:summaryStatus') {
        return { is_stale: false, last_rebuilt_at: 1000000 }
      }
      return []
    })
    const exposeInMainWorld = vi.fn()

    vi.doMock('electron', () => ({
      contextBridge: { exposeInMainWorld },
      ipcRenderer: {
        invoke,
        on: vi.fn(),
        removeListener: vi.fn(),
        send: vi.fn()
      }
    }))
    ;(process as typeof process & { contextIsolated?: boolean }).contextIsolated = true

    await import('../../../../src/preload/index')

    const api = exposeInMainWorld.mock.calls[0]?.[1] as {
      cohort: {
        getVariants: (params: unknown) => Promise<unknown>
        getColumnMeta: () => Promise<unknown>
        getSummary: () => Promise<unknown>
        getCarriers: (variant: { chr: string; pos: number; ref: string; alt: string; variant_type: string; genome_build: string }) => Promise<unknown>
        getGeneBurden: () => Promise<unknown>
        getSummaryStatus: () => Promise<unknown>
        rebuildSummary: () => Promise<unknown>
        runAssociation: (config: unknown) => Promise<unknown>
        cancelAssociation: () => Promise<unknown>
      }
    }

    await expect(api.cohort.getVariants({ limit: 50, offset: 0 })).resolves.toMatchObject({
      code: ErrorCode.DB_ERROR,
      message: 'cohort:variants failed'
    })
    await expect(api.cohort.getColumnMeta()).resolves.toEqual([])
    await expect(api.cohort.getSummary()).resolves.toMatchObject({
      variants: [],
      total_count: 0
    })
    await expect(api.cohort.getCarriers({ chr: 'chr22', pos: 1000, ref: 'A', alt: 'T', variant_type: 'snv', genome_build: 'GRCh38' })).resolves.toEqual([])
    await expect(api.cohort.getGeneBurden()).resolves.toEqual([])
    await expect(api.cohort.getSummaryStatus()).resolves.toMatchObject({
      is_stale: false,
      last_rebuilt_at: 1000000
    })
    await expect(api.cohort.rebuildSummary()).resolves.toBeUndefined()
    await expect(api.cohort.runAssociation({})).resolves.toMatchObject({
      code: ErrorCode.DB_ERROR,
      message: 'cohort:geneBurdenCompare failed'
    })
    await expect(api.cohort.cancelAssociation()).resolves.toBeUndefined()

    expect(invoke).toHaveBeenCalledWith('cohort:variants', { limit: 50, offset: 0 })
    expect(invoke).toHaveBeenCalledWith('cohort:columnMeta')
    expect(invoke).toHaveBeenCalledWith('cohort:summary')
    expect(invoke).toHaveBeenCalledWith('cohort:carriers', { chr: 'chr22', pos: 1000, ref: 'A', alt: 'T', variant_type: 'snv', genome_build: 'GRCh38' })
    expect(invoke).toHaveBeenCalledWith('cohort:geneBurden')
    expect(invoke).toHaveBeenCalledWith('cohort:summaryStatus')
    expect(invoke).toHaveBeenCalledWith('cohort:rebuildSummary')
    expect(invoke).toHaveBeenCalledWith('cohort:geneBurdenCompare', {})
    expect(invoke).toHaveBeenCalledWith('cohort:geneBurdenCancel')
  })
})
