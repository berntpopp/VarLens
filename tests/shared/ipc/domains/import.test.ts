import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ErrorCode } from '../../../../src/shared/types/errors'

describe('import preload domain behavior', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.resetModules()
    vi.doUnmock('electron')
    delete (process as typeof process & { contextIsolated?: boolean }).contextIsolated
  })

  it('forwards all import domain channels without unwrapping in createImportApi', async () => {
    const invoke = vi
      .fn()
      .mockResolvedValueOnce('/path/to/file.vcf')
      .mockResolvedValueOnce(['/path/to/file1.vcf', '/path/to/file2.vcf'])
      .mockResolvedValueOnce('/path/to/file.bed')
      .mockResolvedValueOnce({
        caseId: 1,
        variantCount: 100,
        sampleNames: ['sample1']
      })
      .mockResolvedValueOnce({
        caseId: 1,
        variantCount: 200,
        sampleNames: ['sample1', 'sample2']
      })
      .mockResolvedValueOnce({
        sampleNames: ['sample1'],
        chromosomes: ['chr1']
      })
      .mockResolvedValueOnce({
        results: [
          {
            filePath: '/path/to/file1.vcf',
            sampleNames: ['sample1'],
            chromosomes: ['chr1']
          }
        ]
      })
      .mockResolvedValueOnce(undefined)

    const droppedFile = { name: 'dropped.vcf' } as File
    const rawString = '/renderer/supplied.vcf'
    const getPathForFile = vi.fn((file: File) =>
      file === droppedFile ? '/trusted/dropped.vcf' : ''
    )
    vi.doMock('electron', () => ({
      ipcRenderer: { invoke },
      webUtils: { getPathForFile }
    }))

    const { createImportApi } = await import('../../../../src/preload/domains/import')
    const api = createImportApi()

    await expect(api.selectFile()).resolves.toBe('/path/to/file.vcf')

    await expect(api.selectFiles()).resolves.toEqual(['/path/to/file1.vcf', '/path/to/file2.vcf'])

    await expect(api.selectBedFile()).resolves.toBe('/path/to/file.bed')

    await expect(api.start('/path/to/file.vcf', 'case1')).resolves.toMatchObject({
      caseId: 1,
      variantCount: 100
    })

    await expect(
      api.start('/path/to/file.vcf', 'case1', { selectedSample: 'sample1' })
    ).resolves.toMatchObject({
      caseId: 1,
      variantCount: 200
    })

    await expect(api.vcfPreview('/path/to/file.vcf')).resolves.toMatchObject({
      sampleNames: ['sample1']
    })

    await expect(
      api.vcfMultiPreview(['/path/to/file1.vcf', '/path/to/file2.vcf'])
    ).resolves.toMatchObject({
      results: expect.any(Array)
    })

    await expect(api.cancel()).resolves.toBeUndefined()

    await api.enrollDroppedFiles([droppedFile, rawString as unknown as File])
    expect(getPathForFile).toHaveBeenCalledWith(droppedFile)
    const droppedFileEnrollmentToken = invoke.mock.calls[8]?.[1]
    expect(droppedFileEnrollmentToken).toEqual(expect.any(String))
    expect(invoke).toHaveBeenNthCalledWith(
      9,
      'import:registerDroppedFileEnrollmentToken',
      droppedFileEnrollmentToken
    )
    expect(invoke).toHaveBeenNthCalledWith(10, 'import:enrollDroppedFiles', {
      token: droppedFileEnrollmentToken,
      filePaths: ['/trusted/dropped.vcf']
    })

    expect(invoke).toHaveBeenNthCalledWith(1, 'import:selectFile')
    expect(invoke).toHaveBeenNthCalledWith(2, 'import:selectFiles')
    expect(invoke).toHaveBeenNthCalledWith(3, 'import:selectBedFile')
    expect(invoke).toHaveBeenNthCalledWith(
      4,
      'import:start',
      '/path/to/file.vcf',
      'case1',
      undefined
    )
    expect(invoke).toHaveBeenNthCalledWith(5, 'import:start', '/path/to/file.vcf', 'case1', {
      selectedSample: 'sample1'
    })
    expect(invoke).toHaveBeenNthCalledWith(6, 'import:vcfPreview', '/path/to/file.vcf')
    expect(invoke).toHaveBeenNthCalledWith(7, 'import:vcfMultiPreview', [
      '/path/to/file1.vcf',
      '/path/to/file2.vcf'
    ])
    expect(invoke).toHaveBeenNthCalledWith(8, 'import:cancel')
  })

  it('preload index preserves import transport results when exposing window.api', async () => {
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'import:selectFile' || channel === 'import:selectFiles') {
        return null
      }
      if (channel === 'import:selectBedFile') {
        return null
      }
      if (channel === 'import:cancel') {
        return undefined
      }
      if (
        channel === 'import:start' ||
        channel === 'import:startMultiFile' ||
        channel === 'import:vcfPreview' ||
        channel === 'import:vcfMultiPreview'
      ) {
        return {
          code: ErrorCode.VALIDATION_ERROR,
          message: `${channel} failed`,
          userMessage: `Could not run ${channel}`
        }
      }
      return null
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
      import: {
        selectFile: () => Promise<unknown>
        start: (filePath: string, caseName: string) => Promise<unknown>
        cancel: () => Promise<unknown>
      }
    }

    await expect(api.import.selectFile()).resolves.toBeNull()
    await expect(api.import.start('/path/to/file.vcf', 'case1')).resolves.toMatchObject({
      code: ErrorCode.VALIDATION_ERROR,
      message: 'import:start failed'
    })
    await expect(api.import.cancel()).resolves.toBeUndefined()

    expect(invoke).toHaveBeenCalledWith('import:selectFile')
    expect(invoke).toHaveBeenCalledWith('import:start', '/path/to/file.vcf', 'case1', undefined)
    expect(invoke).toHaveBeenCalledWith('import:cancel')
  })
})
