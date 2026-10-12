/** `p` opens the protein view for the selected row of the active table (case + cohort). */
import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'

import { AppStateKey, createAppState } from '../../../src/renderer/src/composables/useAppState'
import { useProteinViewShortcut } from '../../../src/renderer/src/composables/useProteinViewShortcut'

const row = { chr: 'chr22', pos: 1, ref: 'A', alt: 'G', gene_symbol: 'THOC5' }

function mountTable(selected: unknown, active = true) {
  const state = createAppState()
  const Table = defineComponent({
    setup() {
      useProteinViewShortcut(() => (active ? (selected as never) : null))
      return () => h('div')
    }
  })
  const wrapper = mount(Table, {
    global: { provide: { [AppStateKey as symbol]: state } },
    attachTo: document.body
  })
  return { wrapper, state }
}

const press = (init: KeyboardEventInit = {}): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', { key: 'p', cancelable: true, ...init })
  window.dispatchEvent(event)
  return event
}

describe('useProteinViewShortcut', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('p opens the lollipop for the selected row', () => {
    const { wrapper, state } = mountTable(row)
    expect(press().defaultPrevented).toBe(true)
    expect(state.proteinViewRequest.value).toEqual({ variant: row, tab: 'lollipop' })
    wrapper.unmount()
  })

  it.each([
    ['no selected row', null, true, {}],
    ['inactive view', row, false, {}],
    ['Ctrl+P belongs to the browser', row, true, { ctrlKey: true }]
  ])('%s: does nothing', (_n, selected, active, init) => {
    const { wrapper, state } = mountTable(selected, active)
    expect(press(init).defaultPrevented).toBe(false)
    expect(state.proteinViewOpen.value).toBe(false)
    wrapper.unmount()
  })

  it('typing a p in a field does not open it', () => {
    const { wrapper, state } = mountTable(row)
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()
    press()
    expect(state.proteinViewOpen.value).toBe(false)
    wrapper.unmount()
  })
})
