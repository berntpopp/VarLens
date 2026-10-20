/**
 * Export logic smoke tests — verifies module exports are intact after extraction.
 */

import { describe, it, expect, vi } from 'vitest'
import * as logic from '../../../src/main/ipc/handlers/export-logic'
import type { DatabaseService } from '../../../src/main/database/DatabaseService'

vi.mock('../../../src/main/workers/export-worker-client', () => {
  return {
    ExportWorkerClient: class {
      cancel = vi.fn()
      start = vi.fn().mockImplementation((options: { onError: (err: string) => void }) => {
        options.onError('Worker boom')
      })
    }
  }
})

describe('export-logic exports', () => {
  it('exports expected functions', () => {
    expect(typeof logic.prepareVariantExport).toBe('function')
    expect(typeof logic.buildFilterSummary).toBe('function')
    expect(typeof logic.exportVariants).toBe('function')
    expect(typeof logic.exportCohort).toBe('function')
  })

  it('rejects with an Error when ExportWorkerClient invokes onError (#677)', async () => {
    const mockDb = {
      getPath: () => '/tmp/test.db',
      getEncryptionKey: () => 'test-key'
    } as unknown as DatabaseService

    await expect(
      logic.exportVariants(
        () => mockDb,
        { sql: 'SELECT 1', parameters: [] },
        {},
        'Test Case',
        '/tmp/out.xlsx',
        {}
      )
    ).rejects.toThrow('Worker boom')
  })
})
