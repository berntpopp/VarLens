import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ErrorCode } from '../../../../src/shared/types/errors'

describe('export preload domain behavior', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.resetModules()
    vi.doUnmock('electron')
    delete (process as typeof process & { contextIsolated?: boolean }).contextIsolated
  })

  it('forwards all export domain channels without unwrapping in createExportApi', async () => {
    const invoke = vi
      .fn()
      .mockResolvedValueOnce({
        success: true,
        filePath: '/tmp/variants.xlsx'
      })
      .mockResolvedValueOnce({
        success: true,
        filePath: '/tmp/cohort.xlsx'
      })
      .mockResolvedValueOnce({ success: true })

    vi.doMock('electron', () => ({
      ipcRenderer: { invoke }
    }))

    const { createExportApi } = await import('../../../../src/preload/domains/export')
    const api = createExportApi()

    await expect(
      api.variants(1, { variant_type: ['SNV', 'INDEL'] }, 'Test Case')
    ).resolves.toMatchObject({
      success: true,
      filePath: '/tmp/variants.xlsx'
    })

    await expect(api.cohort({ caseIds: [1, 2], limit: 50, offset: 0 })).resolves.toMatchObject({
      success: true,
      filePath: '/tmp/cohort.xlsx'
    })
    await expect(api.revealInFolder('/tmp/cohort.xlsx')).resolves.toEqual({ success: true })

    expect(invoke).toHaveBeenNthCalledWith(
      1,
      'export:variants',
      1,
      {
        variant_type: ['SNV', 'INDEL']
      },
      'Test Case'
    )
    expect(invoke).toHaveBeenNthCalledWith(2, 'export:cohort', {
      caseIds: [1, 2],
      limit: 50,
      offset: 0
    })
    expect(invoke).toHaveBeenNthCalledWith(3, 'export:revealInFolder', '/tmp/cohort.xlsx')
  })

  it('preload index preserves export transport results when exposing window.api', async () => {
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'export:variants') {
        return {
          success: false,
          error: 'Export cancelled'
        }
      }
      if (channel === 'export:cohort') {
        return {
          code: ErrorCode.INVALID_INPUT,
          message: 'export:cohort failed',
          userMessage: 'Could not export cohort'
        }
      }
      return {
        success: true,
        filePath: '/tmp/result.xlsx'
      }
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
      export: {
        variants: (caseId: number, filters: unknown, caseName: string) => Promise<unknown>
        cohort: (params: unknown) => Promise<unknown>
      }
    }

    await expect(api.export.variants(1, { variant_type: ['SNV'] }, 'Case')).resolves.toMatchObject({
      success: false,
      error: 'Export cancelled'
    })
    await expect(api.export.cohort({ caseIds: [1] })).resolves.toMatchObject({
      code: ErrorCode.INVALID_INPUT,
      message: 'export:cohort failed'
    })

    expect(invoke).toHaveBeenCalledWith('export:variants', 1, { variant_type: ['SNV'] }, 'Case')
    expect(invoke).toHaveBeenCalledWith('export:cohort', { caseIds: [1] })
  })
})
