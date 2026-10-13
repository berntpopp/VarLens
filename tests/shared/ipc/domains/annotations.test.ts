import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ErrorCode } from '../../../../src/shared/types/errors'

describe('annotations preload domain behavior', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.resetModules()
    vi.doUnmock('electron')
    delete (process as typeof process & { contextIsolated?: boolean }).contextIsolated
  })

  it('forwards all annotations domain channels without unwrapping in createAnnotationsApi', async () => {
    const invoke = vi
      .fn()
      .mockResolvedValueOnce({
        id: 1,
        chr: 'chr22',
        pos: 1000,
        ref: 'A',
        alt: 'T',
        global_comment: null,
        starred: 0,
        acmg_classification: null,
        acmg_evidence: null,
        created_at: 1000000,
        updated_at: 1000000
      })
      .mockResolvedValueOnce({
        id: 1,
        chr: 'chr22',
        pos: 1000,
        ref: 'A',
        alt: 'T',
        global_comment: 'test',
        starred: 0,
        acmg_classification: null,
        acmg_evidence: null,
        created_at: 1000000,
        updated_at: 1000000
      })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({
        id: 1,
        case_id: 1,
        variant_id: 1,
        per_case_comment: null,
        starred: 0,
        acmg_classification: null,
        acmg_evidence: null,
        created_at: 1000000,
        updated_at: 1000000
      })
      .mockResolvedValueOnce({
        id: 1,
        case_id: 1,
        variant_id: 1,
        per_case_comment: 'test',
        starred: 0,
        acmg_classification: null,
        acmg_evidence: null,
        created_at: 1000000,
        updated_at: 1000000
      })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({
        global: {
          id: 1,
          chr: 'chr22',
          pos: 1000,
          ref: 'A',
          alt: 'T',
          global_comment: null,
          starred: 0,
          acmg_classification: null,
          acmg_evidence: null,
          created_at: 1000000,
          updated_at: 1000000
        },
        perCase: null
      })
      .mockResolvedValueOnce({
        'chr22:1000:A:T': {
          global: null,
          perCase: {
            id: 1,
            case_id: 1,
            variant_id: 1,
            per_case_comment: null,
            starred: 0,
            acmg_classification: null,
            acmg_evidence: null,
            created_at: 1000000,
            updated_at: 1000000
          }
        }
      })

    vi.doMock('electron', () => ({
      ipcRenderer: { invoke }
    }))

    const { createAnnotationsApi } = await import('../../../../src/preload/domains/annotations')
    const api = createAnnotationsApi()

    await expect(api.getGlobal('chr22', 1000, 'A', 'T', 'GRCh38')).resolves.toMatchObject({
      id: 1,
      chr: 'chr22',
      pos: 1000,
      ref: 'A',
      alt: 'T'
    })

    await expect(
      api.upsertGlobal('chr22', 1000, 'A', 'T', { global_comment: 'test' }, 'GRCh38')
    ).resolves.toMatchObject({
      id: 1,
      global_comment: 'test'
    })

    await expect(api.deleteGlobal('chr22', 1000, 'A', 'T', 'GRCh38')).resolves.toBeUndefined()

    await expect(api.getPerCase(1, 1)).resolves.toMatchObject({
      id: 1,
      case_id: 1,
      variant_id: 1
    })

    await expect(api.upsertPerCase(1, 1, { per_case_comment: 'test' })).resolves.toMatchObject({
      id: 1,
      per_case_comment: 'test'
    })

    await expect(api.deletePerCase(1, 1)).resolves.toBeUndefined()

    await expect(api.getForVariant(1, 'chr22', 1000, 'A', 'T')).resolves.toMatchObject({
      global: {
        id: 1,
        chr: 'chr22'
      },
      perCase: null
    })

    await expect(
      api.batchGet(1, [{ chr: 'chr22', pos: 1000, ref: 'A', alt: 'T' }])
    ).resolves.toMatchObject({
      'chr22:1000:A:T': {
        perCase: {
          id: 1,
          case_id: 1,
          variant_id: 1
        }
      }
    })

    expect(invoke).toHaveBeenNthCalledWith(
      1,
      'annotations:getGlobal',
      'chr22',
      1000,
      'A',
      'T',
      'GRCh38'
    )
    expect(invoke).toHaveBeenNthCalledWith(
      2,
      'annotations:upsertGlobal',
      'chr22',
      1000,
      'A',
      'T',
      { global_comment: 'test' },
      'GRCh38'
    )
    expect(invoke).toHaveBeenNthCalledWith(
      3,
      'annotations:deleteGlobal',
      'chr22',
      1000,
      'A',
      'T',
      'GRCh38'
    )
    expect(invoke).toHaveBeenNthCalledWith(4, 'annotations:getPerCase', 1, 1)
    expect(invoke).toHaveBeenNthCalledWith(5, 'annotations:upsertPerCase', 1, 1, {
      per_case_comment: 'test'
    })
    expect(invoke).toHaveBeenNthCalledWith(6, 'annotations:deletePerCase', 1, 1)
    expect(invoke).toHaveBeenNthCalledWith(
      7,
      'annotations:getForVariant',
      1,
      'chr22',
      1000,
      'A',
      'T'
    )
    expect(invoke).toHaveBeenNthCalledWith(
      8,
      'annotations:batchGet',
      1,
      [{ chr: 'chr22', pos: 1000, ref: 'A', alt: 'T' }],
      undefined
    )
  })

  it('preload index preserves annotations transport results when exposing window.api', async () => {
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'annotations:getGlobal' || channel === 'annotations:getPerCase') {
        return {
          code: ErrorCode.DB_ERROR,
          message: `${channel} failed`,
          userMessage: `Could not run ${channel}`
        }
      }
      if (channel === 'annotations:deleteGlobal' || channel === 'annotations:deletePerCase') {
        return undefined
      }
      return {
        id: 1,
        chr: 'chr22',
        pos: 1000,
        ref: 'A',
        alt: 'T',
        global_comment: null,
        starred: 0,
        acmg_classification: null,
        acmg_evidence: null,
        created_at: 1000000,
        updated_at: 1000000
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
      annotations: {
        getGlobal: (
          chr: string,
          pos: number,
          ref: string,
          alt: string,
          build: string
        ) => Promise<unknown>
        deleteGlobal: (
          chr: string,
          pos: number,
          ref: string,
          alt: string,
          build: string
        ) => Promise<unknown>
        getPerCase: (caseId: number, variantId: number) => Promise<unknown>
      }
    }

    await expect(
      api.annotations.getGlobal('chr22', 1000, 'A', 'T', 'GRCh38')
    ).resolves.toMatchObject({
      code: ErrorCode.DB_ERROR,
      message: 'annotations:getGlobal failed'
    })
    await expect(
      api.annotations.deleteGlobal('chr22', 1000, 'A', 'T', 'GRCh38')
    ).resolves.toBeUndefined()
    await expect(api.annotations.getPerCase(1, 1)).resolves.toMatchObject({
      code: ErrorCode.DB_ERROR,
      message: 'annotations:getPerCase failed'
    })

    expect(invoke).toHaveBeenCalledWith('annotations:getGlobal', 'chr22', 1000, 'A', 'T', 'GRCh38')
    expect(invoke).toHaveBeenCalledWith(
      'annotations:deleteGlobal',
      'chr22',
      1000,
      'A',
      'T',
      'GRCh38'
    )
    expect(invoke).toHaveBeenCalledWith('annotations:getPerCase', 1, 1)
  })
})
