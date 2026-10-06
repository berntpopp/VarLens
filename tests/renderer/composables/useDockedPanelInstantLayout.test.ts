import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import { useDockedPanelInstantLayout } from '../../../src/renderer/src/composables/useDockedPanelInstantLayout'

describe('useDockedPanelInstantLayout', () => {
  let frames: FrameRequestCallback[]

  beforeEach(() => {
    frames = []
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function flushFrame(): void {
    const pending = frames
    frames = []
    pending.forEach((cb) => cb(0))
  }

  it('is instant while a docked panel is open', () => {
    const open = ref(true)
    const docked = ref(true)
    expect(useDockedPanelInstantLayout(open, docked).value).toBe(true)
  })

  it('never applies to the overlay (non-docked) panel', () => {
    const open = ref(true)
    const docked = ref(false)
    expect(useDockedPanelInstantLayout(open, docked).value).toBe(false)
  })

  it('is off while the panel is closed', () => {
    expect(useDockedPanelInstantLayout(ref(false), ref(true)).value).toBe(false)
  })

  it('stays instant for two frames after closing so the un-dock reflow is not animated', async () => {
    const open = ref(true)
    const instant = useDockedPanelInstantLayout(open, ref(true))
    open.value = false
    await nextTick()
    expect(instant.value).toBe(true)
    flushFrame()
    expect(instant.value).toBe(true)
    flushFrame()
    expect(instant.value).toBe(false)
  })

  it('a reopen during the close settle keeps the layout instant', async () => {
    const open = ref(true)
    const instant = useDockedPanelInstantLayout(open, ref(true))
    open.value = false
    await nextTick()
    open.value = true
    await nextTick()
    flushFrame()
    flushFrame()
    expect(instant.value).toBe(true)
  })
})
