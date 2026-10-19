/**
 * Tests for CarrierExpandedRow.vue: the carriers of one expanded cohort row,
 * read from the query cache.
 *
 * A failed carrier load must be told apart from a variant without carriers:
 * the row shows the failure and offers a retry instead of an empty table.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import type { Pinia } from 'pinia'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import CarrierExpandedRow from '../../../../src/renderer/src/components/cohort/CarrierExpandedRow.vue'
import type { CohortCarrier, CohortVariant } from '../../../../src/shared/types/cohort'
import { ASSUMED_HET_HELP } from '../../../../src/shared/utils/genotype'
import { invalidateCarriers } from '../../../../src/renderer/src/queries/carriers'
import { invalidateServerData } from '../../../../src/renderer/src/queries/invalidation'
import { useDatabaseStore } from '../../../../src/renderer/src/stores/databaseStore'
import { MOCK_SQLITE_CAPABILITIES } from '../../../../src/renderer/src/mocks/mockApi'
import { installCapabilities } from '../../helpers/capabilities'
import { createQueryPinia, queryPlugins } from '../../helpers/with-queries'

vi.mock('../../../../src/renderer/src/services/LogService', () => ({
  logService: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() }
}))

const vuetify = createVuetify({ components, directives })

const variant = (pos: number, genome_build: string = 'GRCh38'): CohortVariant =>
  ({
    variant_key: `chr1-${pos}-A-T-${genome_build}`,
    chr: 'chr1',
    pos,
    ref: 'A',
    alt: 'T',
    variant_type: 'snv',
    genome_build
  }) as CohortVariant

const carrier = (name: string, gt = '0/1'): CohortCarrier =>
  ({ case_id: name.length, case_name: name, gt_num: gt }) as CohortCarrier

const failure = { code: 'DB_ERROR', message: 'boom', userMessage: 'boom' }

describe('CarrierExpandedRow', () => {
  const getCarriers = vi.fn()
  const wrappers: VueWrapper[] = []
  let pinia: Pinia

  function mountRow(row: CohortVariant = variant(100)): VueWrapper {
    const wrapper = mount(CarrierExpandedRow, {
      global: { plugins: [vuetify, ...queryPlugins(pinia)] },
      props: { colspan: 5, variant: row },
      attachTo: document.createElement('tbody')
    })
    wrappers.push(wrapper)
    return wrapper
  }

  const failed = (wrapper: VueWrapper): boolean =>
    wrapper.find('[data-testid="carrier-load-error"]').exists()

  beforeEach(() => {
    getCarriers.mockReset().mockResolvedValue([carrier('Case A'), carrier('Case BB', '1/1')])
    Object.assign(window, { api: { cohort: { getCarriers } } })
    pinia = createQueryPinia()
  })

  afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()))

  it('loads and lists the carriers of its variant', async () => {
    const wrapper = mountRow()
    await flushPromises()

    expect(getCarriers).toHaveBeenCalledExactlyOnceWith({
      chr: 'chr1',
      pos: 100,
      ref: 'A',
      alt: 'T',
      variant_type: 'snv',
      genome_build: 'GRCh38'
    })
    expect(wrapper.text()).toContain('Case A')
    expect(wrapper.text()).toContain('het')
    expect(wrapper.text()).toContain('hom')
    expect(failed(wrapper)).toBe(false)
  })

  it("shows each SV carrier's own call metrics, missing ones explicitly (#539)", async () => {
    getCarriers.mockResolvedValue([
      { ...carrier('A'), end_pos: 5000, sv_length: 4000, sv_support: 12, sv_vaf: 0.4, qual: 50 },
      { ...carrier('BB'), end_pos: 4500, sv_length: null, sv_support: null, filter: 'LowQual' }
    ])
    const wrapper = mountRow({ ...variant(1000), alt: '<DEL>', variant_type: 'sv' })
    await flushPromises()

    const cells = (key: string): string[] =>
      wrapper.findAll(`[data-testid="carrier-metric-${key}"]`).map((cell) => cell.text())
    expect(cells('end_pos')).toEqual(['5,000', '4,500'])
    expect(cells('sv_length')).toEqual(['4.00 kb', '--'])
    expect(cells('sv_support')).toEqual(['12', '--'])
    expect(cells('sv_vaf')).toEqual(['0.400', '--'])
    expect(cells('filter')).toEqual(['--', 'LowQual'])
    expect(wrapper.find('[data-testid="carrier-metric-header-copy_number"]').exists()).toBe(false)
  })

  it('labels each carrier by the zygosity of its genotype', async () => {
    getCarriers.mockResolvedValue([
      carrier('A', '1/.'),
      carrier('BB', '.|1'),
      carrier('CCC', '1'),
      carrier('DDDD', './.'),
      carrier('EEEEE', '1|1')
    ])
    const wrapper = mountRow()
    await flushPromises()

    const chips = wrapper.findAll('.v-chip').map((chip) => chip.text())
    // The other allele of a partly missing call is not known: het by assumption.
    expect(chips).toEqual(['assumed het (1/.)', 'assumed het (.|1)', 'hemi', './.', 'hom'])
    expect(wrapper.find('[data-testid="assumed-het-note"]').text()).toBe(ASSUMED_HET_HELP)
  })

  it('explains assumed het only when a carrier has such a call', async () => {
    const wrapper = mountRow()
    await flushPromises()
    expect(wrapper.find('[data-testid="assumed-het-note"]').exists()).toBe(false)
  })

  it('shares one request and the cached list between rows of the same variant', async () => {
    mountRow()
    mountRow()
    await flushPromises()
    mountRow()
    await flushPromises()

    expect(getCarriers).toHaveBeenCalledTimes(1)
  })

  it('shows a failed load as a failure, not as no carriers, and retries on request', async () => {
    getCarriers.mockResolvedValueOnce(failure)
    const wrapper = mountRow()
    await flushPromises()

    expect(failed(wrapper)).toBe(true)
    expect(wrapper.text()).toContain('Carriers could not be loaded')

    await wrapper.find('[data-testid="carrier-load-retry"]').trigger('click')
    await flushPromises()

    expect(failed(wrapper)).toBe(false)
    expect(wrapper.text()).toContain('Case A')
  })

  it('tries a failed variant again when its row is expanded again', async () => {
    getCarriers.mockResolvedValueOnce(failure)
    mountRow().unmount()
    await flushPromises()

    const wrapper = mountRow()
    await flushPromises()
    expect(failed(wrapper)).toBe(false)
    expect(getCarriers).toHaveBeenCalledTimes(2)
  })

  it('never shows the previous variant when its response arrives last', async () => {
    let resolveFirst: (value: CohortCarrier[]) => void = () => {}
    getCarriers.mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)))
    getCarriers.mockResolvedValueOnce([carrier('Second')])
    const wrapper = mountRow()
    await flushPromises()

    await wrapper.setProps({ variant: variant(200) })
    await flushPromises()
    resolveFirst([carrier('First')])
    await flushPromises()

    expect(wrapper.text()).toContain('Second')
    expect(wrapper.text()).not.toContain('First')
  })

  it("does not show another database's carriers for the same variant", async () => {
    let resolveOld: (value: CohortCarrier[]) => void = () => {}
    getCarriers.mockImplementationOnce(() => new Promise((resolve) => (resolveOld = resolve)))
    const wrapper = mountRow()
    await flushPromises()
    getCarriers.mockResolvedValue([carrier('Other database')])

    useDatabaseStore().revision++
    await invalidateServerData('database-switch')
    await flushPromises()
    resolveOld([carrier('Old database')])
    await flushPromises()

    expect(wrapper.text()).toContain('Other database')
    expect(wrapper.text()).not.toContain('Old database')
  })

  it.each([
    ['an import or a case delete', () => invalidateServerData('data-changed')],
    ['a cohort refresh or summary rebuild', () => invalidateCarriers()]
  ])('refetches an expanded row once after %s', async (_name, announce) => {
    const wrapper = mountRow()
    await flushPromises()
    getCarriers.mockClear().mockResolvedValue([carrier('New case')])

    await announce()
    await flushPromises()

    expect(getCarriers).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('New case')
  })

  it('asks for nothing while the backend does not support carriers', async () => {
    installCapabilities({
      storage: {
        ...MOCK_SQLITE_CAPABILITIES,
        cohort: { ...MOCK_SQLITE_CAPABILITIES.cohort, carriers: false }
      }
    })
    mountRow()
    await flushPromises()
    expect(getCarriers).not.toHaveBeenCalled()
  })

  it('emits navigate-to-case with the carrier case', async () => {
    const wrapper = mountRow()
    await flushPromises()

    await wrapper.find('tbody tr .v-btn').trigger('click')
    expect(wrapper.emitted('navigate-to-case')).toEqual([[6]])
  })

  it('respects the genome build of the variant row', async () => {
    getCarriers.mockImplementation(async (asked: { genome_build: string }) => [
      carrier(`Case ${asked.genome_build}`)
    ])
    const wrapper = mountRow(variant(100, 'GRCh38'))
    await flushPromises()
    expect(wrapper.text()).toContain('Case GRCh38')

    await wrapper.setProps({ variant: variant(100, 'GRCh37') })
    await flushPromises()

    expect(getCarriers).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).toContain('Case GRCh37')
    expect(wrapper.text()).not.toContain('Case GRCh38')
  })

  it('applies nested-carriers-table and carrier-subtable classes, verifying DOM computed styles with shared CSS (#662)', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const cssPath = path.resolve(
      __dirname,
      '../../../../src/renderer/src/components/data-table-shared.css'
    )
    const cssContent = fs.readFileSync(cssPath, 'utf-8')

    const styleEl = document.createElement('style')
    styleEl.textContent = cssContent
    document.head.appendChild(styleEl)

    const container = document.createElement('div')
    container.className = 'table-container'
    container.innerHTML = `
      <div class="v-data-table">
        <div class="v-table__wrapper">
          <table class="outer-table">
            <tbody id="outer-tbody"></tbody>
          </table>
        </div>
      </div>
    `
    document.body.appendChild(container)
    const tbody = container.querySelector('#outer-tbody')!

    const wrapper = mount(CarrierExpandedRow, {
      global: { plugins: [vuetify, ...queryPlugins(pinia)] },
      props: { colspan: 5, variant: variant(100) },
      attachTo: tbody
    })
    wrappers.push(wrapper)
    await flushPromises()

    const outerTable = container.querySelector('.outer-table') as HTMLElement
    const innerTableWrapper = wrapper.find('.nested-carriers-table .v-table__wrapper > table')
    expect(innerTableWrapper.exists()).toBe(true)
    const innerTable = innerTableWrapper.element as HTMLElement

    // Outer table preserves fixed layout and zero width
    const outerStyle = window.getComputedStyle(outerTable)
    expect(outerStyle.tableLayout).toBe('fixed')
    expect(outerStyle.width).toBe('0px')

    // Inner subtable has auto layout and full width (does not inherit width: 0)
    const innerStyle = window.getComputedStyle(innerTable)
    expect(innerStyle.tableLayout).toBe('auto')
    expect(innerStyle.width).toBe('100%')

    // Inner table elements have carrier-subtable class
    expect(wrapper.find('.carrier-subtable').exists()).toBe(true)

    // Every th and td has max-width: none
    const cells = wrapper.findAll('.carrier-subtable th, .carrier-subtable td')
    expect(cells.length).toBeGreaterThan(0)
    for (const cell of cells) {
      const cellStyle = window.getComputedStyle(cell.element)
      expect(cellStyle.maxWidth).toBe('none')
    }

    // Renders Case, Zygosity, GQ, DP and visible View in Case button
    const tableText = wrapper.find('.carrier-subtable').text()
    expect(tableText).toContain('Case')
    expect(tableText).toContain('Zygosity')
    expect(tableText).toContain('GQ')
    expect(tableText).toContain('DP')
    const viewBtn = wrapper.find('tbody tr .v-btn')
    expect(viewBtn.exists()).toBe(true)
    expect(viewBtn.text()).toContain('View in Case')

    // Clean up DOM
    styleEl.remove()
    container.remove()
  })
})
