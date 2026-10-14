/**
 * Tag dots in the row annotations (#125): case rows toggle their own tags
 * from one shared menu; cohort rows show the carriers' tags read-only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import type { Pinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { useQueryCache } from '@pinia/colada'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import AnnotationsCell from '../../../../src/renderer/src/components/table-cells/AnnotationsCell.vue'
import TagQuickMenu from '../../../../src/renderer/src/components/table-cells/TagQuickMenu.vue'
import { provideTagQuickMenu } from '../../../../src/renderer/src/components/table-cells/tag-quick-menu'
import type { Tag } from '../../../../src/shared/types/database-entities'
import { queryKeys } from '../../../../src/renderer/src/queries/keys'
import { createQueryPinia, queryPlugins } from '../../helpers/with-queries'

vi.mock('../../../../src/renderer/src/services/LogService', () => ({
  logService: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }
}))

const vuetify = createVuetify({ components, directives })
const tag = (id: number, name: string, color: string): Tag =>
  ({ id, name, color, created_at: 0 }) as Tag
const TAGS = [
  tag(1, 'Benign/artifact', '#4CAF50'),
  tag(2, 'Pathogenic candidate', '#F44336'),
  tag(3, 'Reported', '#2196F3'),
  tag(4, 'VUS follow-up', '#FFC107'),
  tag(5, 'Zeta', '#9E9E9E')
]
const cellProps = { isStarred: false, acmgClassification: null, hasComment: false }

describe('row tag dots', () => {
  const api = {
    list: vi.fn(),
    getVariantTags: vi.fn(),
    assignVariantTag: vi.fn(),
    removeVariantTag: vi.fn()
  }
  let pinia: Pinia

  beforeEach(() => {
    Object.values(api).forEach((fn) => fn.mockReset())
    api.list.mockResolvedValue(TAGS)
    api.getVariantTags.mockResolvedValue([])
    api.assignVariantTag.mockResolvedValue(undefined)
    api.removeVariantTag.mockResolvedValue(undefined)
    Object.assign(window, { api: { tags: api } })
    pinia = createQueryPinia()
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  async function mountRow(variant: Record<string, unknown>, tagSource: 'case' | 'carriers') {
    const Table = defineComponent({
      setup() {
        const state = provideTagQuickMenu()
        return () =>
          h('div', [
            h(AnnotationsCell, { ...cellProps, variant: variant as never, tagSource }),
            h(TagQuickMenu, { state })
          ])
      }
    })
    const wrapper = mount(Table, {
      global: { plugins: [vuetify, ...queryPlugins(pinia)] },
      attachTo: document.body
    })
    await flushPromises()
    return { wrapper, button: () => wrapper.get('button.tag-btn') }
  }

  const menuItems = (): HTMLElement[] => [
    ...document.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"]')
  ]

  it('shows a case row its tags as dots and toggles a tag with one click', async () => {
    const { wrapper, button } = await mountRow({ id: 10, case_id: 1, tag_ids: [2] }, 'case')
    expect(wrapper.findAll('.tag-dot')).toHaveLength(1)
    expect(button().attributes('aria-label')).toBe('Tags: Pathogenic candidate — change tags')
    // A settled write reads the row back, so the fake server keeps the assignments.
    const server = new Set([2])
    api.assignVariantTag.mockImplementation(async (_c, _v, id: number) => void server.add(id))
    api.removeVariantTag.mockImplementation(async (_c, _v, id: number) => void server.delete(id))
    api.getVariantTags.mockImplementation(async () => TAGS.filter((t) => server.has(t.id)))

    await button().trigger('click')
    await flushPromises()
    const items = menuItems()
    // menuitemcheckbox needs a menu parent (axe aria-required-parent)
    expect(items.every((el) => el.parentElement?.getAttribute('role') === 'menu')).toBe(true)
    expect(items.map((el) => el.getAttribute('aria-checked'))).toEqual([
      'false',
      'true',
      'false',
      'false',
      'false'
    ])

    items[2].click() // Reported
    await flushPromises()
    expect(api.assignVariantTag).toHaveBeenCalledWith(1, 10, 3)
    expect(wrapper.findAll('.tag-dot')).toHaveLength(2)
    expect(menuItems()[2].getAttribute('aria-checked')).toBe('true')

    menuItems()[1].click() // Pathogenic candidate, assigned: removed
    await flushPromises()
    expect(api.removeVariantTag).toHaveBeenCalledWith(1, 10, 2)
    expect(button().attributes('aria-label')).toBe('Tags: Reported — change tags')
    wrapper.unmount()
  })

  it("follows a change made in the details panel (the variant's query entry)", async () => {
    const { wrapper, button } = await mountRow({ id: 13, case_id: 1, tag_ids: [2] }, 'case')
    wrapper.vm.$.appContext.app.runWithContext(() =>
      useQueryCache().setQueryData(queryKeys.variantTags(1, 13), [TAGS[2], TAGS[3]])
    )
    await flushPromises()
    expect(button().attributes('aria-label')).toBe('Tags: Reported, VUS follow-up — change tags')
    wrapper.unmount()
  })

  it('puts the dot back when the write fails', async () => {
    api.assignVariantTag.mockRejectedValue(new Error('offline'))
    const { wrapper, button } = await mountRow({ id: 11, case_id: 1, tag_ids: [] }, 'case')
    await button().trigger('click')
    await flushPromises()
    menuItems()[0].click()
    await flushPromises()
    expect(wrapper.findAll('.tag-dot')).toHaveLength(0)
    expect(button().attributes('aria-label')).toBe('Add tag')
    wrapper.unmount()
  })

  it('shows the server tags when the first of two overlapping writes fails', async () => {
    let failFirst!: (e: Error) => void
    let finishSecond!: () => void
    api.assignVariantTag
      .mockReturnValueOnce(new Promise((_, reject) => (failFirst = reject)))
      .mockReturnValueOnce(new Promise<void>((resolve) => (finishSecond = resolve)))
    // What the database holds once the second write (Benign/artifact) landed.
    api.getVariantTags.mockResolvedValue([TAGS[0], TAGS[1]])
    const { wrapper, button } = await mountRow({ id: 14, case_id: 1, tag_ids: [2] }, 'case')
    await button().trigger('click')
    await flushPromises()
    menuItems()[2].click() // Reported: will fail
    menuItems()[0].click() // Benign/artifact: will succeed
    await flushPromises()
    failFirst(new Error('offline'))
    await flushPromises()
    finishSecond()
    await flushPromises()
    expect(button().attributes('aria-label')).toBe(
      'Tags: Benign/artifact, Pathogenic candidate — change tags'
    )
    wrapper.unmount()
  })

  it('keeps the box at four slots: three dots and a plus beyond four tags', async () => {
    const { wrapper } = await mountRow({ id: 12, case_id: 1, tag_ids: [1, 2, 3, 4, 5] }, 'case')
    expect(wrapper.findAll('.tag-dot')).toHaveLength(3)
    expect(wrapper.find('.tag-dots-more').exists()).toBe(true)
    wrapper.unmount()
  })

  it('shows a cohort row the carriers’ tags read-only', async () => {
    const { wrapper, button } = await mountRow({ chr: '1', pos: 1, tag_ids: [3, 4] }, 'carriers')
    expect(wrapper.findAll('.tag-dot')).toHaveLength(2)
    expect(button().attributes('aria-label')).toBe('Tags: Reported, VUS follow-up')

    await button().trigger('click')
    await flushPromises()
    expect(menuItems()).toHaveLength(0)
    expect(document.body.textContent).toContain('Assign tags in the case view')
    expect(document.body.textContent).toContain('VUS follow-up')
    expect(api.assignVariantTag).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('renders no tag button outside a table', () => {
    const wrapper = mount(AnnotationsCell, {
      props: { ...cellProps, tagSource: 'case' },
      global: { plugins: [vuetify] }
    })
    expect(wrapper.find('button.tag-btn').exists()).toBe(false)
  })
})
