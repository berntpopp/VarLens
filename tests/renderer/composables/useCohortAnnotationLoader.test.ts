/**
 * The cohort table's annotation hydration applies the page-change guard:
 * a global batch still in flight for the previous page is dropped.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { withSetup } from '../../utils/test-helpers'
import { createMockApi } from '../../utils/mock-api'
import { useCohortAnnotationLoader } from '@renderer/composables/useCohortAnnotationLoader'
import { annotationCache, _resetAnnotationsForTesting } from '@renderer/composables/useAnnotations'

const PAGE_1 = [{ chr: 'chr1', pos: 100, ref: 'A', alt: 'G', variant_key: 'ignored' }]
const PAGE_2 = [{ chr: 'chr2', pos: 200, ref: 'C', alt: 'T' }]
const EMPTY = { global: null, perCase: null }

describe('useCohortAnnotationLoader', () => {
  let app: { unmount: () => void }
  let resolvers: Array<(value: unknown) => void>

  beforeEach(() => {
    vi.useFakeTimers()
    _resetAnnotationsForTesting()
    window.api = createMockApi()
    resolvers = []
    window.api.annotations.batchGet = vi.fn(
      () => new Promise((resolve) => resolvers.push(resolve))
    ) as never
  })

  afterEach(() => {
    app?.unmount()
    vi.useRealTimers()
  })

  function setup(): ReturnType<typeof useCohortAnnotationLoader> {
    const [loader, appInstance] = withSetup(() => useCohortAnnotationLoader())
    app = appInstance
    return loader
  }

  it('loads the visible rows as one global batch, coordinates only', async () => {
    const { hydrate } = setup()

    hydrate(PAGE_1)
    expect(window.api.annotations.batchGet).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(150)

    expect(window.api.annotations.batchGet).toHaveBeenCalledTimes(1)
    expect(window.api.annotations.batchGet).toHaveBeenCalledWith(null, [
      { chr: 'chr1', pos: 100, ref: 'A', alt: 'G' }
    ])
    resolvers[0]({ 'chr1:100:A:G': EMPTY })
    await vi.runAllTimersAsync()
    expect(annotationCache.value.has('chr1:100:A:G')).toBe(true)
  })

  it('collapses rapid page changes into one batch for the last page', async () => {
    const { hydrate } = setup()

    hydrate(PAGE_1)
    await vi.advanceTimersByTimeAsync(50)
    hydrate(PAGE_2)
    await vi.advanceTimersByTimeAsync(150)

    expect(window.api.annotations.batchGet).toHaveBeenCalledTimes(1)
    expect(window.api.annotations.batchGet).toHaveBeenCalledWith(null, [
      { chr: 'chr2', pos: 200, ref: 'C', alt: 'T' }
    ])
  })

  it('drops a batch that resolves after the table moved to another page', async () => {
    const { hydrate } = setup()

    hydrate(PAGE_1)
    await vi.advanceTimersByTimeAsync(150)
    // The table pages while the page-1 batch is still in flight.
    hydrate(PAGE_2)
    resolvers[0]({ 'chr1:100:A:G': EMPTY })
    await vi.advanceTimersByTimeAsync(150)
    resolvers[1]({ 'chr2:200:C:T': EMPTY })
    await vi.runAllTimersAsync()

    expect([...annotationCache.value.keys()]).toEqual(['chr2:200:C:T'])
  })

  it('issues no IPC for an empty page', async () => {
    const { hydrate } = setup()

    hydrate([])
    await vi.advanceTimersByTimeAsync(150)

    expect(window.api.annotations.batchGet).not.toHaveBeenCalled()
  })
})
