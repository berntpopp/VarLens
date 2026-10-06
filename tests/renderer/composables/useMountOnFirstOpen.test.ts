import { describe, expect, it } from 'vitest'
import { nextTick, ref } from 'vue'

import { useMountOnFirstOpen } from '../../../src/renderer/src/composables/useMountOnFirstOpen'

describe('useMountOnFirstOpen', () => {
  it('stays unmounted until the source first opens, then latches', async () => {
    const open = ref(false)
    const mounted = useMountOnFirstOpen(() => open.value)
    expect(mounted.value).toBe(false)

    open.value = true
    expect(mounted.value).toBe(true)

    open.value = false
    await nextTick()
    expect(mounted.value).toBe(true)
  })

  it('is mounted immediately when the source starts open', () => {
    const mounted = useMountOnFirstOpen(() => true)
    expect(mounted.value).toBe(true)
  })
})
