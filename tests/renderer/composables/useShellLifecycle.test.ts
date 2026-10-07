import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import type { BatchCompleteEvent, BatchFileCompleteEvent } from '../../../src/shared/types/api'
import {
  LIVE_REFRESH_INTERVAL_MS,
  useShellLifecycle
} from '../../../src/renderer/src/composables/useShellLifecycle'
import { useLiveDataSignal } from '../../../src/renderer/src/composables/useLiveDataSignal'

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

  describe('per-file completion during a batch', () => {
    function fileEvent(overrides: Partial<BatchFileCompleteEvent> = {}): BatchFileCompleteEvent {
      return {
        runId: 'run-1',
        index: 0,
        totalFiles: 8,
        fileName: 'HG001.vcf',
        caseName: 'HG001',
        status: 'success',
        caseId: 1,
        ...overrides
      }
    }

    function setup(ownsRun = true) {
      let emitFile: (event: BatchFileCompleteEvent) => void = () => {}
      let emitComplete: (event: BatchCompleteEvent) => void = () => {}
      const incrementDataGeneration = vi.fn()
      const refreshCases = vi.fn()
      const softRefreshCases = vi.fn()
      const lifecycle = useShellLifecycle({
        api: {
          batchImport: {
            onFileComplete: (callback: typeof emitFile) => {
              emitFile = callback
              return vi.fn()
            },
            onComplete: (callback: typeof emitComplete) => {
              emitComplete = callback
              return vi.fn()
            }
          }
        } as never,
        currentDatabasePath: ref(null),
        currentDatabaseName: ref('VarLens'),
        incrementDataGeneration,
        resetForDatabaseSwitch: vi.fn(),
        clearMetadataCache: vi.fn(),
        selectCase: vi.fn(),
        caseListRef: ref({ refreshCases, softRefreshCases, selectCase: vi.fn() }),
        dialogHostRef: ref(null),
        importStore: {
          importComplete: vi.fn(),
          clearBatchRun: vi.fn(),
          isCurrentBatchRun: vi.fn().mockReturnValue(ownsRun)
        } as never
      })
      lifecycle.setupBatchFileCompleteListener()
      lifecycle.setupBatchImportCompletionListener()
      return {
        emitFile: (event: BatchFileCompleteEvent) => emitFile(event),
        emitComplete: (event: BatchCompleteEvent) => emitComplete(event),
        incrementDataGeneration,
        refreshCases,
        softRefreshCases
      }
    }

    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    it('refreshes in place at once, then coalesces a burst into one trailing refresh', () => {
      const { liveDataGeneration } = useLiveDataSignal()
      const before = liveDataGeneration.value
      const ctx = setup()

      ctx.emitFile(fileEvent({ index: 0, caseId: 1 }))
      expect(ctx.softRefreshCases).toHaveBeenCalledTimes(1)
      expect(liveDataGeneration.value).toBe(before + 1)

      ctx.emitFile(fileEvent({ index: 1, caseId: 2 }))
      ctx.emitFile(fileEvent({ index: 2, caseId: 3 }))
      expect(ctx.softRefreshCases).toHaveBeenCalledTimes(1)

      vi.advanceTimersByTime(LIVE_REFRESH_INTERVAL_MS)
      // The last file of the burst is never missed.
      expect(ctx.softRefreshCases).toHaveBeenCalledTimes(2)
      expect(liveDataGeneration.value).toBe(before + 2)

      // A per-file signal is not a full reload: no list reset, no global bump.
      expect(ctx.refreshCases).not.toHaveBeenCalled()
      expect(ctx.incrementDataGeneration).not.toHaveBeenCalled()
    })

    it('ignores files that were skipped or failed', () => {
      const ctx = setup()
      ctx.emitFile(fileEvent({ status: 'skipped', caseId: undefined }))
      ctx.emitFile(fileEvent({ status: 'failed', caseId: undefined, error: 'bad file' }))
      vi.advanceTimersByTime(LIVE_REFRESH_INTERVAL_MS)
      expect(ctx.softRefreshCases).not.toHaveBeenCalled()
    })

    it('ignores a file of a batch run this window does not own', () => {
      const { liveDataGeneration } = useLiveDataSignal()
      const before = liveDataGeneration.value
      const ctx = setup(false)
      ctx.emitFile(fileEvent({ runId: 'foreign-run' }))
      vi.advanceTimersByTime(LIVE_REFRESH_INTERVAL_MS)
      expect(ctx.softRefreshCases).not.toHaveBeenCalled()
      expect(liveDataGeneration.value).toBe(before)
    })

    it('still runs the full refresh when the batch ends, dropping a pending in-place one', () => {
      const ctx = setup()
      ctx.emitFile(fileEvent({ index: 0 }))
      ctx.emitFile(fileEvent({ index: 1, caseId: 2 }))
      ctx.emitComplete({
        runId: 'run-1',
        succeeded: 2,
        failed: 0,
        skipped: 0,
        cancelled: false,
        details: []
      })

      expect(ctx.incrementDataGeneration).toHaveBeenCalledTimes(1)
      expect(ctx.refreshCases).toHaveBeenCalledTimes(1)

      vi.advanceTimersByTime(LIVE_REFRESH_INTERVAL_MS * 2)
      expect(ctx.softRefreshCases).toHaveBeenCalledTimes(1)
    })
  })
  // A browser reload mid-batch loses the page's run id, not the batch: the job
  // keeps running on the server. Its job snapshots keep the views current.
  describe('a batch import this page did not start', () => {
    type JobEvent = {
      id: string
      kind: string
      status: string
      params?: { runId?: string }
      progress?: { current: number; total: number }
    }

    function setup(ownRunId: string | null = null) {
      let emitJob: (job: JobEvent) => void = () => {}
      let emitComplete: (event: { runId: string } & Record<string, unknown>) => void = () => {}
      const incrementDataGeneration = vi.fn()
      const refreshCases = vi.fn()
      const softRefreshCases = vi.fn()
      let currentRun = ownRunId
      const lifecycle = useShellLifecycle({
        api: {
          batchImport: {
            onFileComplete: () => vi.fn(),
            onComplete: (callback: typeof emitComplete) => {
              emitComplete = callback
              return vi.fn()
            }
          },
          jobs: {
            onChanged: (callback: typeof emitJob) => {
              emitJob = callback
              return vi.fn()
            }
          }
        } as never,
        currentDatabasePath: ref(null),
        currentDatabaseName: ref('VarLens'),
        incrementDataGeneration,
        resetForDatabaseSwitch: vi.fn(),
        clearMetadataCache: vi.fn(),
        selectCase: vi.fn(),
        caseListRef: ref({ refreshCases, softRefreshCases, selectCase: vi.fn() }),
        dialogHostRef: ref(null),
        importStore: {
          importComplete: vi.fn(),
          clearBatchRun: vi.fn(() => {
            currentRun = null
          }),
          isCurrentBatchRun: vi.fn((runId: string) => runId === currentRun)
        } as never
      })
      lifecycle.setupBatchImportCompletionListener()
      lifecycle.setupBatchJobFollower()
      return { emitJob, emitComplete, incrementDataGeneration, refreshCases, softRefreshCases }
    }

    const job = (overrides: Partial<JobEvent> = {}): JobEvent => ({
      id: 'job-1',
      kind: 'import_batch',
      status: 'running',
      params: { runId: 'run-before-reload' },
      progress: { current: 0, total: 100 },
      ...overrides
    })

    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    it('refreshes in place as its files finish and reloads once when it ends', () => {
      const ctx = setup()
      ctx.emitJob(job())
      expect(ctx.softRefreshCases).not.toHaveBeenCalled()

      ctx.emitJob(job({ progress: { current: 1, total: 100 } }))
      expect(ctx.softRefreshCases).toHaveBeenCalledTimes(1)
      // Progress without a newly finished file is not a reason to refresh.
      ctx.emitJob(job({ progress: { current: 1, total: 100 } }))
      vi.advanceTimersByTime(LIVE_REFRESH_INTERVAL_MS)
      expect(ctx.softRefreshCases).toHaveBeenCalledTimes(1)

      ctx.emitJob(job({ progress: { current: 60, total: 100 } }))
      expect(ctx.softRefreshCases).toHaveBeenCalledTimes(2)
      expect(ctx.refreshCases).not.toHaveBeenCalled()

      ctx.emitJob(job({ status: 'completed', progress: { current: 100, total: 100 } }))
      expect(ctx.refreshCases).toHaveBeenCalledTimes(1)
      expect(ctx.incrementDataGeneration).toHaveBeenCalledTimes(1)
    })

    it('reloads when the followed batch is cancelled or fails', () => {
      const ctx = setup()
      ctx.emitJob(job({ status: 'cancelled' }))
      ctx.emitJob(job({ id: 'job-2', status: 'failed' }))
      expect(ctx.refreshCases).toHaveBeenCalledTimes(2)
    })

    it('leaves a batch this page started to its own events, also after it finished', () => {
      const ctx = setup('run-1')
      ctx.emitJob(job({ params: { runId: 'run-1' }, progress: { current: 3, total: 8 } }))
      expect(ctx.softRefreshCases).not.toHaveBeenCalled()

      ctx.emitComplete({ runId: 'run-1', succeeded: 8, failed: 0, skipped: 0, details: [] })
      expect(ctx.refreshCases).toHaveBeenCalledTimes(1)
      // The job snapshot of the same batch arrives after the completion event.
      ctx.emitJob(job({ params: { runId: 'run-1' }, status: 'completed' }))
      expect(ctx.refreshCases).toHaveBeenCalledTimes(1)
    })

    it('ignores other kinds of jobs', () => {
      const ctx = setup()
      ctx.emitJob(job({ kind: 'case_delete', status: 'completed' }))
      ctx.emitJob(job({ kind: 'import_single', progress: { current: 5, total: 9 } }))
      expect(ctx.refreshCases).not.toHaveBeenCalled()
      expect(ctx.softRefreshCases).not.toHaveBeenCalled()
    })
  })
})
