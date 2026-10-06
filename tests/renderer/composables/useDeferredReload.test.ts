import { nextTick, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { withSetup } from '../../utils/test-helpers'
import { useDeferredReload } from '@renderer/composables/useDeferredReload'

describe('useDeferredReload', () => {
  it('reloads immediately while active', async () => {
    const reload = vi.fn()
    const [d, app] = withSetup(() => useDeferredReload(ref(true), reload))
    await d.requestReload()
    expect(reload).toHaveBeenCalledTimes(1)
    app.unmount()
  })

  it('defers a reload requested while hidden and replays it once on activation', async () => {
    const active = ref(false)
    const reload = vi.fn()
    const [d, app] = withSetup(() => useDeferredReload(active, reload))
    await d.requestReload()
    d.markPending()
    expect(reload).not.toHaveBeenCalled()
    expect(d.isPending()).toBe(true)

    active.value = true
    await nextTick()
    expect(reload).toHaveBeenCalledTimes(1)
    expect(d.isPending()).toBe(false)

    active.value = false
    await nextTick()
    active.value = true
    await nextTick()
    expect(reload).toHaveBeenCalledTimes(1)
    app.unmount()
  })
})
