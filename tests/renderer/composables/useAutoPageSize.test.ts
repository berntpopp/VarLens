import { beforeEach, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import {
  AUTO_PAGE_SIZE,
  AUTO_PAGE_SIZE_TITLE,
  MAX_AUTO_ROWS,
  MIN_AUTO_ROWS,
  buildPageSizeOptions,
  computeFitRows,
  measureTableBody,
  pageKeepingFirstRow,
  useAutoPageSize
} from '../../../src/renderer/src/composables/useAutoPageSize'
import { useSettingsStore } from '../../../src/renderer/src/stores/settingsStore'

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
})

describe('auto (fit) page size rules', () => {
  it('fits whole rows into the body and clamps to a sane range', () => {
    expect(computeFitRows(400, 36)).toBe(11)
    expect(computeFitRows(50, 36)).toBe(MIN_AUTO_ROWS)
    expect(computeFitRows(100000, 36)).toBe(MAX_AUTO_ROWS)
    expect(computeFitRows(0, 36)).toBe(MIN_AUTO_ROWS)
  })

  it('offers a sentinel Auto option while off, and labels the fit size while on', () => {
    expect(buildPageSizeOptions([10, 25], false, 17)).toEqual([
      10,
      25,
      { title: AUTO_PAGE_SIZE_TITLE, value: AUTO_PAGE_SIZE }
    ])
    // A fixed option equal to the fit count is hidden so the select shows "Auto"
    expect(buildPageSizeOptions([10, 25], true, 25)).toEqual([
      10,
      { title: AUTO_PAGE_SIZE_TITLE, value: 25 }
    ])
  })

  it('keeps the first visible row on screen when the page size changes', () => {
    expect(pageKeepingFirstRow(3, 25, 10)).toBe(6) // row 51 -> page 6 of 10
    expect(pageKeepingFirstRow(6, 10, 25)).toBe(3) // row 51 -> page 3 of 25
    expect(pageKeepingFirstRow(1, 25, 17)).toBe(1)
  })

  it('measures the body below the sticky header', () => {
    const container = document.createElement('div')
    container.innerHTML =
      '<div class="v-table__wrapper"><table><thead><tr><th>x</th></tr></thead><tbody></tbody></table></div>'
    const wrapper = container.querySelector('.v-table__wrapper') as HTMLElement
    Object.defineProperty(wrapper, 'clientHeight', { value: 400 })
    const thead = container.querySelector('thead') as HTMLElement
    thead.getBoundingClientRect = () => ({ height: 40 }) as DOMRect
    expect(measureTableBody(container)?.body).toBe(360)
  })
})

describe('useAutoPageSize v-model', () => {
  function setup(initial = 25) {
    const itemsPerPage = ref(initial)
    const page = ref(1)
    let api!: ReturnType<typeof useAutoPageSize>
    const Host = defineComponent({
      setup() {
        api = useAutoPageSize({
          itemsPerPage,
          page,
          fixedOptions: [10, 25, 50, 100],
          container: ref(null),
          rowCount: ref(0)
        })
        return () => h('div')
      }
    })
    mount(Host)
    return { itemsPerPage, page, api }
  }

  it('turns Auto on from the sentinel and off again with a fixed choice', async () => {
    const { itemsPerPage, api } = setup()
    const settings = useSettingsStore()
    api.tableItemsPerPage.value = AUTO_PAGE_SIZE
    expect(settings.autoFitPageSize).toBe(true)
    expect(itemsPerPage.value).toBe(25) // no container yet: size unchanged, never the sentinel
    api.tableItemsPerPage.value = 50
    await nextTick()
    expect(settings.autoFitPageSize).toBe(false)
    expect(itemsPerPage.value).toBe(50)
  })

  it('ignores the Auto option re-emitting its own fit count while active', () => {
    const { itemsPerPage, api } = setup(25)
    const settings = useSettingsStore()
    settings.autoFitPageSize = true
    api.fitRows.value = 25
    api.tableItemsPerPage.value = 25
    expect(settings.autoFitPageSize).toBe(true)
    expect(itemsPerPage.value).toBe(25)
  })
})
