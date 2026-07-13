import { describe, expect, it, vi } from 'vitest'
import { ErrorCode } from '../../../src/shared/types/errors'
import { useZipExtractionLifecycle } from '../../../src/renderer/src/composables/useZipExtractionLifecycle'

describe('useZipExtractionLifecycle', () => {
  it('cleans each owned extraction exactly once across concurrent cleanup calls', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const cleanupZipTemp = vi.fn(async () => {
      await gate
    })
    const lifecycle = useZipExtractionLifecycle(cleanupZipTemp)
    lifecycle.track('extraction-1')

    const first = lifecycle.cleanup()
    const second = lifecycle.cleanup()
    expect(cleanupZipTemp).toHaveBeenCalledOnce()
    expect(cleanupZipTemp).toHaveBeenCalledWith('extraction-1')

    release()
    await Promise.all([first, second])
    await lifecycle.cleanup()
    expect(cleanupZipTemp).toHaveBeenCalledOnce()
  })

  it('retains failed ownership so a later cleanup can retry it', async () => {
    const cleanupZipTemp = vi
      .fn()
      .mockResolvedValueOnce({
        code: ErrorCode.UNKNOWN,
        message: 'transport failed',
        userMessage: 'Cleanup failed'
      })
      .mockResolvedValueOnce(undefined)
    const lifecycle = useZipExtractionLifecycle(cleanupZipTemp)
    lifecycle.track('extraction-1')

    await expect(lifecycle.cleanup()).rejects.toMatchObject({ code: ErrorCode.UNKNOWN })
    await expect(lifecycle.cleanup()).resolves.toBeUndefined()

    expect(cleanupZipTemp).toHaveBeenCalledTimes(2)
    expect(cleanupZipTemp).toHaveBeenNthCalledWith(2, 'extraction-1')
  })

  it('does not lose a newer extraction tracked while an older cleanup is pending', async () => {
    let releaseFirst!: () => void
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const cleanupZipTemp = vi.fn(async (extractionId: string) => {
      if (extractionId === 'extraction-1') await firstGate
    })
    const lifecycle = useZipExtractionLifecycle(cleanupZipTemp)
    lifecycle.track('extraction-1')

    const firstCleanup = lifecycle.cleanup()
    lifecycle.track('extraction-2')
    const secondCleanup = lifecycle.cleanup()
    await Promise.resolve()
    expect(cleanupZipTemp).toHaveBeenCalledWith('extraction-2')
    releaseFirst()
    await Promise.all([firstCleanup, secondCleanup])

    expect(cleanupZipTemp).toHaveBeenCalledTimes(2)
    expect(cleanupZipTemp).toHaveBeenCalledWith('extraction-1')
    expect(cleanupZipTemp).toHaveBeenCalledWith('extraction-2')
  })
})
