import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref } from 'vue'
import { usePanelFocus } from '../../../src/renderer/src/composables/usePanelFocus'

afterEach(() => {
  document.body.innerHTML = ''
})

describe('usePanelFocus', () => {
  it('focuses the heading on open and returns focus to the selected row on close', async () => {
    const open = ref(false)
    // Closing the panel clears the selection (as the app does)
    const selected = ref(true)
    const Host = defineComponent({
      setup() {
        const heading = ref<HTMLElement | null>(null)
        usePanelFocus(() => open.value, heading)
        return () =>
          h('main', { tabindex: -1 }, [
            h('table', [
              h('tbody', [
                h('tr', selected.value ? { class: 'variant-row--selected', tabindex: 0 } : {})
              ])
            ]),
            h('h2', { ref: heading, tabindex: -1 }, 'Variant Details')
          ])
      }
    })
    const wrapper = mount(Host, { attachTo: document.body })
    // A mouse click on a row inside <main tabindex=-1> leaves focus on <main>
    ;(wrapper.element as HTMLElement).focus()
    open.value = true
    await nextTick()
    await nextTick()
    expect(document.activeElement?.tagName).toBe('H2')
    open.value = false
    selected.value = false
    await nextTick()
    await nextTick()
    await vi.waitFor(() => expect(document.activeElement).toBe(wrapper.get('tr').element))
  })
})
