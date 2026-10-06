/**
 * Table chrome that is invisible until used must not be mounted with the
 * table: column-header filter menus, the columns drawer content and the
 * shortlist score tooltip are created on first use.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import VariantColumnHeader from '../../../../src/renderer/src/components/variant-table/VariantColumnHeader.vue'
import ColumnsDrawer from '../../../../src/renderer/src/components/ColumnsDrawer.vue'
import { useRowHoverTarget } from '../../../../src/renderer/src/components/shortlist/useRowHoverTarget'
import { withSetup } from '../../../utils/test-helpers'

const vuetify = createVuetify({ components, directives })

afterEach(() => {
  vi.useRealTimers()
  document.body.innerHTML = ''
})

describe('VariantColumnHeader filter menu', () => {
  const props = {
    headerColumn: { key: 'gene_symbol', title: 'Gene' },
    getSortIcon: () => '$sortAsc',
    toggleSort: () => {},
    isSorted: () => false,
    hasFilter: false
  }

  it('mounts no menu until the filter button is used, then toggles it', async () => {
    const wrapper = mount(VariantColumnHeader, {
      props,
      global: { plugins: [vuetify] },
      attachTo: document.body
    })
    expect(wrapper.findComponent(components.VMenu).exists()).toBe(false)
    const button = wrapper.get('button[aria-label="Filter Gene"]')
    expect(button.attributes('aria-haspopup')).toBe('menu')
    expect(button.attributes('aria-expanded')).toBe('false')

    await button.trigger('click')
    expect(wrapper.findComponent(components.VMenu).exists()).toBe(true)
    expect(button.attributes('aria-expanded')).toBe('true')

    await button.trigger('click')
    expect(button.attributes('aria-expanded')).toBe('false')
    wrapper.unmount()
  })
})

describe('ColumnsDrawer content', () => {
  it('renders its content only after the first open and keeps it afterwards', async () => {
    const open = ref(false)
    const Host = defineComponent({
      render: () =>
        h(components.VLayout, () =>
          h(ColumnsDrawer, {
            open: open.value,
            columns: [{ key: 'gene_symbol', title: 'Gene' }],
            visibleColumns: ['gene_symbol'],
            tableId: 'test-table'
          })
        )
    })
    const wrapper = mount(Host, { global: { plugins: [vuetify] }, attachTo: document.body })
    expect(wrapper.text()).not.toContain('columns visible')

    open.value = true
    await nextTick()
    expect(wrapper.text()).toContain('1 of 1 columns visible')

    open.value = false
    await nextTick()
    expect(wrapper.text()).toContain('1 of 1 columns visible')
    wrapper.unmount()
  })
})

describe('useRowHoverTarget', () => {
  function cellWith(id: string): { cell: HTMLElement; inner: HTMLElement } {
    const cell = document.createElement('span')
    cell.setAttribute('data-tip', id)
    const inner = document.createElement('b')
    cell.appendChild(inner)
    document.body.appendChild(cell)
    return { cell, inner }
  }

  function over(target: Element): MouseEvent {
    const event = new MouseEvent('mouseover', { bubbles: true })
    Object.defineProperty(event, 'target', { value: target })
    return event
  }

  function out(target: Element, related: Element | null): MouseEvent {
    const event = new MouseEvent('mouseout', { bubbles: true, relatedTarget: related })
    Object.defineProperty(event, 'target', { value: target })
    return event
  }

  it('opens after the delay for the hovered row and closes on leave', () => {
    vi.useFakeTimers()
    const [hover, app] = withSetup(() => useRowHoverTarget('data-tip', 400))
    const { cell, inner } = cellWith('7')

    hover.onMouseover(over(inner))
    expect(hover.open.value).toBe(false)
    vi.advanceTimersByTime(400)
    expect(hover.open.value).toBe(true)
    expect(hover.element.value).toBe(cell)
    expect(hover.rowId.value).toBe('7')

    // Moving within the trigger keeps it open; leaving closes it.
    hover.onMouseout(out(inner, cell))
    expect(hover.open.value).toBe(true)
    hover.onMouseout(out(cell, document.body))
    expect(hover.open.value).toBe(false)
    app.unmount()
  })

  it('ignores elements outside a trigger and cancels a pending open on leave', () => {
    vi.useFakeTimers()
    const [hover, app] = withSetup(() => useRowHoverTarget('data-tip', 400))
    const { cell } = cellWith('1')

    hover.onMouseover(over(document.body))
    hover.onMouseover(over(cell))
    hover.onMouseout(out(cell, document.body))
    vi.advanceTimersByTime(1000)
    expect(hover.open.value).toBe(false)
    app.unmount()
  })
})
