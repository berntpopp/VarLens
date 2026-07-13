import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import type { BatchCompleteEvent } from '../../../src/shared/types/api'
import { useShellLifecycle } from '../../../src/renderer/src/composables/useShellLifecycle'

describe('useShellLifecycle', () => {
  it('bumps data generation and refreshes cases on batch import completion', async () => {
    const incrementDataGeneration = vi.fn()
    const refreshCases = vi.fn().mockResolvedValue(undefined)

    const lifecycle = useShellLifecycle({
      api: undefined,
      currentDatabasePath: ref(null),
      currentDatabaseName: ref('VarLens'),
      incrementDataGeneration,
      resetForDatabaseSwitch: vi.fn(),
      clearMetadataCache: vi.fn(),
      selectCase: vi.fn(),
      caseListRef: ref({
        refreshCases,
        selectCase: vi.fn()
      }),
      dialogHostRef: ref(null),
      importStore: {
        importComplete: vi.fn()
      } as never
    })

    await lifecycle.handleBatchImportComplete()

    expect(incrementDataGeneration).toHaveBeenCalledTimes(1)
    expect(refreshCases).toHaveBeenCalledTimes(1)
  })

  it('wires batch import completion through the lifecycle listener', () => {
    const onComplete = vi.fn()
    const incrementDataGeneration = vi.fn()
    const refreshCases = vi.fn().mockResolvedValue(undefined)
    const importComplete = vi.fn()
    const clearBatchRun = vi.fn()

    const lifecycle = useShellLifecycle({
      api: {
        batchImport: {
          onComplete
        }
      } as never,
      currentDatabasePath: ref(null),
      currentDatabaseName: ref('VarLens'),
      incrementDataGeneration,
      resetForDatabaseSwitch: vi.fn(),
      clearMetadataCache: vi.fn(),
      selectCase: vi.fn(),
      caseListRef: ref({
        refreshCases,
        selectCase: vi.fn()
      }),
      dialogHostRef: ref(null),
      importStore: {
        importComplete,
        isCurrentBatchRun: vi.fn().mockReturnValue(true),
        clearBatchRun
      } as never
    })

    const cleanup = vi.fn()
    onComplete.mockImplementation((callback: (result: BatchCompleteEvent) => void) => {
      callback({
        runId: 'run-1',
        succeeded: 1,
        failed: 0,
        skipped: 0,
        cancelled: false,
        details: [{ filePath: '/case-a.json', fileName: 'case-a', status: 'success' }]
      })
      return cleanup
    })

    const registeredCleanup = lifecycle.setupBatchImportCompletionListener()

    expect(importComplete).toHaveBeenCalledWith({
      succeeded: 1,
      failed: 0,
      skipped: 0,
      cancelled: false,
      details: [
        {
          filePath: '/case-a.json',
          fileName: 'case-a',
          caseName: 'case-a',
          status: 'success'
        }
      ]
    })
    expect(incrementDataGeneration).toHaveBeenCalledTimes(1)
    expect(refreshCases).toHaveBeenCalledTimes(1)
    expect(clearBatchRun).toHaveBeenCalledWith('run-1')
    expect(registeredCleanup).toBe(cleanup)
  })

  it('ignores completion events that do not own the current batch run', () => {
    const onComplete = vi.fn()
    const incrementDataGeneration = vi.fn()
    const refreshCases = vi.fn()
    const importComplete = vi.fn()
    const isCurrentBatchRun = vi.fn().mockReturnValue(false)

    const lifecycle = useShellLifecycle({
      api: { batchImport: { onComplete } } as never,
      currentDatabasePath: ref(null),
      currentDatabaseName: ref('VarLens'),
      incrementDataGeneration,
      resetForDatabaseSwitch: vi.fn(),
      clearMetadataCache: vi.fn(),
      selectCase: vi.fn(),
      caseListRef: ref({ refreshCases, selectCase: vi.fn() }),
      dialogHostRef: ref(null),
      importStore: { importComplete, isCurrentBatchRun } as never
    })

    onComplete.mockImplementation((callback) => {
      callback({
        runId: 'stale-run',
        succeeded: 1,
        failed: 0,
        skipped: 0,
        cancelled: false,
        details: []
      })
      return vi.fn()
    })

    lifecycle.setupBatchImportCompletionListener()

    expect(isCurrentBatchRun).toHaveBeenCalledWith('stale-run')
    expect(importComplete).not.toHaveBeenCalled()
    expect(incrementDataGeneration).not.toHaveBeenCalled()
    expect(refreshCases).not.toHaveBeenCalled()
  })

  it('consumes a terminal run id so duplicate completion events refresh only once', () => {
    const onComplete = vi.fn()
    const incrementDataGeneration = vi.fn()
    const refreshCases = vi.fn()
    const importComplete = vi.fn()
    let activeRunId: string | null = 'run-1'
    const isCurrentBatchRun = vi.fn((runId: string) => activeRunId === runId)
    const clearBatchRun = vi.fn((runId: string) => {
      if (activeRunId === runId) activeRunId = null
    })

    const lifecycle = useShellLifecycle({
      api: { batchImport: { onComplete } } as never,
      currentDatabasePath: ref(null),
      currentDatabaseName: ref('VarLens'),
      incrementDataGeneration,
      resetForDatabaseSwitch: vi.fn(),
      clearMetadataCache: vi.fn(),
      selectCase: vi.fn(),
      caseListRef: ref({ refreshCases, selectCase: vi.fn() }),
      dialogHostRef: ref(null),
      importStore: { importComplete, isCurrentBatchRun, clearBatchRun } as never
    })

    onComplete.mockImplementation((callback) => {
      const event = {
        runId: 'run-1',
        succeeded: 1,
        failed: 0,
        skipped: 0,
        cancelled: false,
        details: []
      }
      callback(event)
      callback(event)
      return vi.fn()
    })

    lifecycle.setupBatchImportCompletionListener()

    expect(importComplete).toHaveBeenCalledOnce()
    expect(clearBatchRun).toHaveBeenCalledOnce()
    expect(incrementDataGeneration).toHaveBeenCalledOnce()
    expect(refreshCases).toHaveBeenCalledOnce()
  })
})
