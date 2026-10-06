import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'
import { usePanelFocus } from '../../../src/renderer/src/composables/usePanelFocus'

afterEach(() => {
  document.body.innerHTML = ''
})

describe('usePanelFocus (lazy-mounted panel)', () => {
  it('focuses the heading when the (lazy-mounted) panel mounts already open', async () => {
    const Host = defineComponent({
      setup() {
        const heading = ref<HTMLElement | null>(null)
        usePanelFocus(() => true, heading)
        return () => h('aside', [h('h2', { ref: heading, tabindex: -1 }, 'Variant Details')])
      }
    })
    mount(Host, { attachTo: document.body })
    await vi.waitFor(() => expect(document.activeElement?.tagName).toBe('H2'))
  })
})
