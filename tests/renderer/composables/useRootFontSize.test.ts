import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import {
  DEFAULT_ROOT_FONT_PX,
  readRootFontPx,
  remToPx,
  useRootFontSize
} from '../../../src/renderer/src/composables/useRootFontSize'

afterEach(() => {
  document.documentElement.style.fontSize = ''
})

describe('useRootFontSize', () => {
  it('converts rem to whole px at the current root size', () => {
    expect(remToPx(3, 16)).toBe(48)
    expect(remToPx(3, 32)).toBe(96)
    expect(remToPx(3, 13.33)).toBe(40)
  })

  it('reads the root font size in px', () => {
    document.documentElement.style.fontSize = '32px'
    expect(readRootFontPx()).toBe(32)
    expect(DEFAULT_ROOT_FONT_PX).toBe(16)
  })

  it('exposes the root size to components and cleans up its probe element', async () => {
    document.documentElement.style.fontSize = '24px'
    let value = 0
    const Probe = defineComponent({
      setup() {
        const size = useRootFontSize()
        return () => {
          value = size.value
          return h('div')
        }
      }
    })
    const before = document.body.children.length
    const w = mount(Probe, { attachTo: document.body })
    await nextTick()
    expect(value).toBe(24)
    w.unmount()
    expect(document.body.children.length).toBeLessThanOrEqual(before)
  })
})
