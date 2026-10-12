import { afterEach, describe, expect, it } from 'vitest'
import { h } from 'vue'
import { mount, enableAutoUnmount } from '@vue/test-utils'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import { VLayout } from 'vuetify/components'
import ColumnsDrawer from '../../../src/renderer/src/components/ColumnsDrawer.vue'
import { COLUMNS_DRAWER_COPY } from '../../../src/renderer/src/config/uiCopyConfig'

enableAutoUnmount(afterEach)

function mountDrawer(onUpdate: (open: boolean) => void = () => undefined) {
  return mount(
    {
      render: () =>
        h(VLayout, () =>
          h(ColumnsDrawer, {
            open: true,
            columns: [
              { key: 'chr', title: 'Chr' },
              { key: 'pos', title: 'Position' }
            ],
            visibleColumns: ['chr'],
            tableId: 'test',
            'onUpdate:open': onUpdate
          })
        )
    },
    { attachTo: document.body, global: { plugins: [createVuetify({ components, directives })] } }
  )
}

describe('ColumnsDrawer accessibility', () => {
  it('names every checkbox after its column or group', () => {
    const wrapper = mountDrawer()
    const labels = wrapper.findAll('input[type="checkbox"]').map((i) => i.attributes('aria-label'))
    expect(labels).toEqual([
      COLUMNS_DRAWER_COPY.group('Core Fields'),
      COLUMNS_DRAWER_COPY.column('Chr'),
      COLUMNS_DRAWER_COPY.column('Position'),
      COLUMNS_DRAWER_COPY.group('External Links')
    ])
    expect(wrapper.find('.v-navigation-drawer').attributes('aria-label')).toBe(
      COLUMNS_DRAWER_COPY.drawer
    )
  })

  it('sets the native indeterminate state on a partly shown group', () => {
    const wrapper = mountDrawer()
    const group = wrapper.find('input[type="checkbox"]').element as HTMLInputElement
    expect(group.indeterminate).toBe(true)
  })

  it('closes on Escape', async () => {
    const updates: boolean[] = []
    const wrapper = mountDrawer((open) => updates.push(open))
    await wrapper.find('.v-navigation-drawer').trigger('keydown', { key: 'Escape' })
    expect(updates).toContain(false)
  })
})
