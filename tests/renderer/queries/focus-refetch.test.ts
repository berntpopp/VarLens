/**
 * Focus and reconnect refetch: on in the web workspace, off on desktop,
 * decided by the capability document and nothing else.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { useQuery } from '@pinia/colada'
import {
  FOCUS_REFETCH_INTERVAL_MS,
  installFocusRefetch
} from '../../../src/renderer/src/queries/focus-refetch'
import { queryKeys } from '../../../src/renderer/src/queries/keys'
import { useCapabilityStore } from '../../../src/renderer/src/stores/capabilityStore'
import { installCapabilities } from '../helpers/capabilities'
import { createQueryPinia, withQueries } from '../helpers/with-queries'

vi.mock('../../../src/renderer/src/services/LogService', () => ({
  logService: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() }
}))

describe('focus and reconnect refetch', () => {
  const load = vi.fn()
  let uninstall: () => void
  let unmount: () => void
  let visibility: 'visible' | 'hidden'

  function lookAway(ms: number): void {
    visibility = 'hidden'
    document.dispatchEvent(new Event('visibilitychange'))
    vi.advanceTimersByTime(ms)
    visibility = 'visible'
    document.dispatchEvent(new Event('visibilitychange'))
  }

  async function mountQuery(runtime: 'desktop' | 'web'): Promise<void> {
    const pinia = createQueryPinia()
    installCapabilities({ runtime })
    uninstall = installFocusRefetch()
    const host = withQueries(
      () => useQuery({ key: () => [...queryKeys.root(), 'probe'], query: load }),
      pinia
    )
    unmount = host.unmount
    await flushPromises()
    load.mockClear()
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    load.mockReset().mockResolvedValue('data')
    visibility = 'visible'
    uninstall = () => undefined
    unmount = () => undefined
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
  })

  afterEach(() => {
    unmount()
    uninstall()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('the capability document turns it on for web and off for desktop', () => {
    createQueryPinia()
    expect(useCapabilityStore().refetchOnFocus).toBe(false)
    installCapabilities({ runtime: 'web' })
    expect(useCapabilityStore().refetchOnFocus).toBe(true)
  })

  it('is off until the capability document has loaded', () => {
    createQueryPinia()
    useCapabilityStore().$patch({ document: null })
    expect(useCapabilityStore().refetchOnFocus).toBe(false)
  })

  it('desktop: neither focus nor reconnect refetches anything', async () => {
    await mountQuery('desktop')

    lookAway(10 * FOCUS_REFETCH_INTERVAL_MS)
    window.dispatchEvent(new Event('online'))
    await flushPromises()

    expect(load).not.toHaveBeenCalled()
  })

  it('web: refetches what is mounted when the window is looked at again', async () => {
    await mountQuery('web')

    lookAway(FOCUS_REFETCH_INTERVAL_MS)
    await flushPromises()

    expect(load).toHaveBeenCalledTimes(1)
  })

  it('web: switching windows quickly does not refetch every time', async () => {
    await mountQuery('web')

    lookAway(FOCUS_REFETCH_INTERVAL_MS)
    await flushPromises()
    lookAway(1000)
    lookAway(1000)
    await flushPromises()

    expect(load).toHaveBeenCalledTimes(1)
  })

  it('web: does not refetch when the window is hidden', async () => {
    await mountQuery('web')

    vi.advanceTimersByTime(FOCUS_REFETCH_INTERVAL_MS)
    visibility = 'hidden'
    document.dispatchEvent(new Event('visibilitychange'))
    await flushPromises()

    expect(load).not.toHaveBeenCalled()
  })

  it('web: refetches when the network comes back, whenever that is', async () => {
    await mountQuery('web')

    window.dispatchEvent(new Event('online'))
    await flushPromises()

    expect(load).toHaveBeenCalledTimes(1)
  })

  it('stops listening once removed', async () => {
    await mountQuery('web')
    uninstall()

    lookAway(FOCUS_REFETCH_INTERVAL_MS)
    window.dispatchEvent(new Event('online'))
    await flushPromises()

    expect(load).not.toHaveBeenCalled()
  })
})
