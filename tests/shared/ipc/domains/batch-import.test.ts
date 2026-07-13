import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ErrorCode } from '../../../../src/shared/types/errors'

describe('batch-import preload domain behavior', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.resetModules()
    vi.doUnmock('electron')
    delete (process as typeof process & { contextIsolated?: boolean }).contextIsolated
  })

  it('forwards all batch-import domain channels without unwrapping in createBatchImportApi', async () => {
    const invoke = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(['/path/to/file1.json'])
      .mockResolvedValueOnce({
        files: [
          {
            filePath: '/path/to/file1.json',
            fileName: 'file1.json',
            caseName: 'Case1',
            isDuplicate: false
          }
        ],
        duplicateCount: 0
      })
      .mockResolvedValueOnce({
        succeeded: 1,
        failed: 0,
        skipped: 0,
        cancelled: false,
        details: [
          {
            filePath: '/path/to/file1.json',
            fileName: 'file1.json',
            caseName: 'Case1',
            succeeded: true
          }
        ]
      })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({
        filePath: '/path/to/archive.zip',
        isEncrypted: false
      })
      .mockResolvedValueOnce({
        success: true
      })
      .mockResolvedValueOnce({
        files: ['/extracted/file1.json', '/extracted/file2.json'],
        errors: [],
        extractionId: '11111111-1111-4111-8111-111111111111'
      })
      .mockResolvedValueOnce(undefined)

    vi.doMock('electron', () => ({
      ipcRenderer: { invoke }
    }))

    const { createBatchImportApi } = await import('../../../../src/preload/domains/batch-import')
    const api = createBatchImportApi()

    await expect(api.selectFiles()).resolves.toEqual([])

    await expect(api.selectFolder()).resolves.toEqual(['/path/to/file1.json'])

    await expect(api.checkDuplicates(['/path/to/file1.json'])).resolves.toMatchObject({
      files: [
        {
          filePath: '/path/to/file1.json',
          caseName: 'Case1'
        }
      ],
      duplicateCount: 0
    })

    await expect(
      api.start(['/path/to/file1.json'], 'skip', undefined, 'desktop-run-1')
    ).resolves.toMatchObject({
      succeeded: 1,
      failed: 0
    })

    await expect(api.cancel()).resolves.toBeUndefined()

    await expect(api.selectZip()).resolves.toMatchObject({
      filePath: '/path/to/archive.zip',
      isEncrypted: false
    })

    await expect(api.testZipPassword('/path/to/archive.zip', 'password')).resolves.toMatchObject({
      success: true
    })

    await expect(api.extractZip('/path/to/archive.zip')).resolves.toMatchObject({
      files: ['/extracted/file1.json', '/extracted/file2.json'],
      errors: []
    })

    await expect(
      api.cleanupZipTemp('11111111-1111-4111-8111-111111111111')
    ).resolves.toBeUndefined()

    expect(invoke).toHaveBeenNthCalledWith(1, 'batch-import:selectFiles')
    expect(invoke).toHaveBeenNthCalledWith(2, 'batch-import:selectFolder')
    expect(invoke).toHaveBeenNthCalledWith(
      3,
      'batch-import:checkDuplicates',
      ['/path/to/file1.json'],
      undefined
    )
    expect(invoke).toHaveBeenNthCalledWith(
      4,
      'batch-import:start',
      ['/path/to/file1.json'],
      'skip',
      undefined,
      'desktop-run-1'
    )
    expect(invoke).toHaveBeenNthCalledWith(5, 'batch-import:cancel')
    expect(invoke).toHaveBeenNthCalledWith(6, 'batch-import:selectZip')
    expect(invoke).toHaveBeenNthCalledWith(
      7,
      'batch-import:testZipPassword',
      '/path/to/archive.zip',
      'password'
    )
    expect(invoke).toHaveBeenNthCalledWith(
      8,
      'batch-import:extractZip',
      '/path/to/archive.zip',
      undefined
    )
    expect(invoke).toHaveBeenNthCalledWith(
      9,
      'batch-import:cleanupZipTemp',
      '11111111-1111-4111-8111-111111111111'
    )
  })

  it('preload index preserves batch-import transport results when exposing window.api', async () => {
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'batch-import:selectFiles' || channel === 'batch-import:selectFolder') {
        return []
      }
      if (channel === 'batch-import:cancel' || channel === 'batch-import:cleanupZipTemp') {
        return undefined
      }
      if (channel === 'batch-import:selectZip') {
        return {
          filePath: '/path/to/archive.zip',
          isEncrypted: false
        }
      }
      if (channel === 'batch-import:testZipPassword') {
        return {
          code: ErrorCode.WRONG_PASSWORD,
          message: 'Password test failed',
          userMessage: 'Invalid password'
        }
      }
      if (channel === 'batch-import:extractZip') {
        return {
          files: [],
          errors: ['extraction error']
        }
      }
      return {
        files: [],
        duplicateCount: 0
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
      batchImport: {
        selectFiles: () => Promise<unknown>
        selectFolder: () => Promise<unknown>
        checkDuplicates: (filePaths: string[], stripText?: string) => Promise<unknown>
        cancel: () => Promise<unknown>
        selectZip: () => Promise<unknown>
        testZipPassword: (zipPath: string, password: string) => Promise<unknown>
        cleanupZipTemp: (extractionId: string) => Promise<unknown>
      }
    }

    await expect(api.batchImport.selectFiles()).resolves.toEqual([])
    await expect(api.batchImport.selectFolder()).resolves.toEqual([])
    await expect(api.batchImport.checkDuplicates(['/file.json'])).resolves.toMatchObject({
      files: [],
      duplicateCount: 0
    })
    await expect(api.batchImport.cancel()).resolves.toBeUndefined()
    await expect(api.batchImport.selectZip()).resolves.toMatchObject({
      filePath: '/path/to/archive.zip',
      isEncrypted: false
    })
    await expect(api.batchImport.testZipPassword('/archive.zip', 'pwd')).resolves.toMatchObject({
      code: ErrorCode.WRONG_PASSWORD,
      message: 'Password test failed'
    })
    await expect(
      api.batchImport.cleanupZipTemp('11111111-1111-4111-8111-111111111111')
    ).resolves.toBeUndefined()

    expect(invoke).toHaveBeenCalledWith('batch-import:selectFiles')
    expect(invoke).toHaveBeenCalledWith('batch-import:selectFolder')
    expect(invoke).toHaveBeenCalledWith('batch-import:checkDuplicates', ['/file.json'], undefined)
    expect(invoke).toHaveBeenCalledWith('batch-import:cancel')
    expect(invoke).toHaveBeenCalledWith('batch-import:selectZip')
    expect(invoke).toHaveBeenCalledWith('batch-import:testZipPassword', '/archive.zip', 'pwd')
    expect(invoke).toHaveBeenCalledWith(
      'batch-import:cleanupZipTemp',
      '11111111-1111-4111-8111-111111111111'
    )
  })
})
