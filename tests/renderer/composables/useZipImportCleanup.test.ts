import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import { useZipImportCleanup } from '../../../src/renderer/src/composables/useZipImportCleanup'
import type { DuplicateCheckResult } from '../../../src/shared/types/api'
import type { IpcResult } from '../../../src/shared/types/errors'

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function createHarness(checkDuplicatesRequest: ReturnType<typeof vi.fn>) {
  const cleanupRequest = vi.fn(async () => undefined)
  const importStore = {
    importError: vi.fn()
  }
  const state = {
    step: ref(2),
    selectedFilePaths: ref(['/tmp/current.json']),
    reviewFiles: ref([]),
    duplicateCount: ref(0),
    stripText: ref(''),
    isZipImport: ref(true),
    zipPath: ref('/tmp/archive.zip'),
    zipExtractionId: ref('extraction-current'),
    zipPasswordNeeded: ref(false),
    zipPassword: ref(''),
    zipError: ref(''),
    showZipPassword: ref(false),
    zipUnlocking: ref(false)
  }
  const cleanup = useZipImportCleanup({
    cleanupRequest,
    checkDuplicatesRequest,
    importStore: importStore as never,
    state
  })
  return { cleanup, cleanupRequest, importStore, state }
}

describe('useZipImportCleanup request ownership', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('ignores an older duplicate response that resolves after a newer response', async () => {
    vi.useFakeTimers()
    const first = deferred<IpcResult<DuplicateCheckResult>>()
    const second = deferred<IpcResult<DuplicateCheckResult>>()
    const request = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const { cleanup, state } = createHarness(request)

    cleanup.scheduleDuplicateRecheck()
    await vi.advanceTimersByTimeAsync(300)
    state.stripText.value = 'new'
    cleanup.scheduleDuplicateRecheck()
    await vi.advanceTimersByTimeAsync(300)

    second.resolve({ files: [], duplicateCount: 2 })
    await second.promise
    first.resolve({ files: [], duplicateCount: 1 })
    await first.promise
    await Promise.resolve()

    expect(state.duplicateCount.value).toBe(2)
    vi.useRealTimers()
  })

  it('does not let a stale duplicate failure clean the current extraction', async () => {
    vi.useFakeTimers()
    const first = deferred<IpcResult<DuplicateCheckResult>>()
    const second = deferred<IpcResult<DuplicateCheckResult>>()
    const request = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const { cleanup, cleanupRequest, state } = createHarness(request)

    cleanup.scheduleDuplicateRecheck()
    await vi.advanceTimersByTimeAsync(300)
    state.stripText.value = 'new'
    cleanup.scheduleDuplicateRecheck()
    await vi.advanceTimersByTimeAsync(300)
    second.resolve({ files: [], duplicateCount: 0 })
    await second.promise
    first.resolve({ code: 'DATABASE_ERROR', message: 'old request failed' } as never)
    await first.promise
    await Promise.resolve()

    expect(cleanupRequest).not.toHaveBeenCalled()
    expect(state.zipExtractionId.value).toBe('extraction-current')
    vi.useRealTimers()
  })

  it('sends the captured extraction ID when abandoning ZIP state', async () => {
    const { cleanup, cleanupRequest, state } = createHarness(vi.fn())

    cleanup.abandonZipImport('close')
    await Promise.resolve()

    expect(cleanupRequest).toHaveBeenCalledWith('extraction-current')
    expect(state.zipExtractionId.value).toBe('')
  })

  it('retains cleanup authority after a failure so cleanup can be retried', async () => {
    const { cleanup, cleanupRequest, importStore, state } = createHarness(vi.fn())
    cleanupRequest.mockResolvedValueOnce({
      code: 'UNKNOWN',
      message: 'directory is busy',
      userMessage: 'Could not clean temporary files'
    })

    await cleanup.cleanupZipTemp('first attempt')

    expect(state.zipExtractionId.value).toBe('extraction-current')
    expect(importStore.importError).toHaveBeenCalled()

    await cleanup.cleanupZipTemp('retry')

    expect(cleanupRequest).toHaveBeenCalledTimes(2)
    expect(state.zipExtractionId.value).toBe('')
  })

  it('retries failed abandoned-extraction cleanup on the next lifecycle cleanup', async () => {
    const { cleanup, cleanupRequest } = createHarness(vi.fn())
    cleanupRequest.mockResolvedValueOnce({
      code: 'UNKNOWN',
      message: 'directory is busy',
      userMessage: 'Could not clean temporary files'
    })

    cleanup.abandonZipImport('dialog close')
    await Promise.resolve()
    await Promise.resolve()
    await cleanup.cleanupZipTemp('next dialog close')

    expect(cleanupRequest).toHaveBeenNthCalledWith(1, 'extraction-current')
    expect(cleanupRequest).toHaveBeenNthCalledWith(2, 'extraction-current')
  })

  it('retries cleanup lost from duplicate-check failure state on the next lifecycle cleanup', async () => {
    const { cleanup, cleanupRequest, state } = createHarness(vi.fn())
    cleanupRequest.mockResolvedValueOnce({
      code: 'UNKNOWN',
      message: 'directory is busy',
      userMessage: 'Could not clean temporary files'
    })

    await cleanup.handleDuplicateCheckFailure(new Error('duplicate check failed'))
    expect(state.zipExtractionId.value).toBe('')

    await cleanup.cleanupZipTemp('next dialog close')

    expect(cleanupRequest).toHaveBeenNthCalledWith(1, 'extraction-current')
    expect(cleanupRequest).toHaveBeenNthCalledWith(2, 'extraction-current')
  })
})
