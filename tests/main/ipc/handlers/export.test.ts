import { describe, it, expect, vi } from 'vitest'
import {
  prepareVariantExport,
  exportVariants
} from '../../../../src/main/ipc/handlers/export-logic'
import { toSerializableError, wrapHandler } from '../../../../src/main/ipc/errorHandler'
import type { DatabaseService } from '../../../../src/main/database/DatabaseService'
import { AppError } from '../../../../src/main/ipc/errors'
import { ErrorCode } from '../../../../src/shared/types/errors'

vi.mock('../../../../src/main/workers/export-worker-client', () => {
  return {
    ExportWorkerClient: class {
      cancel = vi.fn()
      start = vi.fn().mockImplementation((options: { onError: (err: string) => void }) => {
        options.onError('Disk full during export')
      })
    }
  }
})

describe('export error handling (#677)', () => {
  it('throws AppError and preserves userMessage when count > 100_000', async () => {
    const mockDb = {
      variants: {
        getExportCount: () => 150_000,
        compileExportQuery: vi.fn()
      }
    } as unknown as DatabaseService

    let caughtError: unknown
    try {
      await prepareVariantExport(() => mockDb, 1, {})
    } catch (err) {
      caughtError = err
    }

    expect(caughtError).toBeInstanceOf(AppError)
    const appError = caughtError as AppError
    expect(appError.code).toBe(ErrorCode.VALIDATION)
    expect(appError.userMessage).toContain('Export limited to 100,000 variants')
    expect(appError.userMessage).toContain('150,000 variants')

    // Verify through toSerializableError (used by wrapHandler)
    const serializable = toSerializableError(caughtError)
    expect(serializable.code).toBe(ErrorCode.VALIDATION)
    expect(serializable.userMessage).toContain('Export limited to 100,000 variants')
    expect(serializable.userMessage).not.toBe('An unexpected error occurred. Please try again.')
  })

  it('preserves userMessage when wrapped handler catches count limit error', async () => {
    const mockDb = {
      variants: {
        getExportCount: () => 120_000,
        compileExportQuery: vi.fn()
      }
    } as unknown as DatabaseService

    const res = await wrapHandler(async () => {
      return await prepareVariantExport(() => mockDb, 1, {})
    })

    expect('userMessage' in res).toBe(true)
    if ('userMessage' in res) {
      expect(res.userMessage).toContain('Export limited to 100,000 variants')
    }
  })

  it('rejects with AppError and preserves worker error details in userMessage', async () => {
    const mockDb = {
      getPath: () => '/tmp/test.db',
      getEncryptionKey: () => 'test-key'
    } as unknown as DatabaseService

    let caughtError: unknown
    try {
      await exportVariants(
        () => mockDb,
        { sql: 'SELECT 1', parameters: [] },
        {},
        'Test Case',
        '/tmp/out.xlsx',
        {}
      )
    } catch (err) {
      caughtError = err
    }

    expect(caughtError).toBeInstanceOf(AppError)
    const appError = caughtError as AppError
    expect(appError.userMessage).toBe('Disk full during export')

    const serializable = toSerializableError(caughtError)
    expect(serializable.userMessage).toBe('Disk full during export')
  })
})
