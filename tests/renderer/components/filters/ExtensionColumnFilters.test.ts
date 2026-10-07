/**
 * Tests for ExtensionColumnFilters.vue and the per-column control it renders.
 *
 * The component reads which variant types a scope has and each column's
 * metadata from the query cache, so these tests mock `window.api` and mount
 * with Pinia and the query cache installed, like the app does.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import type { Pinia } from 'pinia'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import type { ColumnFilterMeta } from '../../../../src/shared/types/column-filters'
import ExtensionColumnFilters from '../../../../src/renderer/src/components/filters/ExtensionColumnFilters.vue'
import { invalidateServerData } from '../../../../src/renderer/src/queries/invalidation'
import { useDatabaseStore } from '../../../../src/renderer/src/stores/databaseStore'
import { createQueryPinia, queryPlugins } from '../../helpers/with-queries'

vi.mock('../../../../src/renderer/src/services/LogService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

interface Scope {
  caseId?: number
  caseIds?: number[]
}

// What the mocked API answers; individual tests change these before mounting.
const typesPresentResponse = { current: new Set<string>() }
const columnMetaFailureKeys = new Set<string>()
const typesPresent = vi.fn<(scope: Scope) => Promise<string[]>>(async () => [
  ...typesPresentResponse.current
])
/** Metadata whose `max` names the case it was loaded for. */
const columnMeta = vi.fn(
  async (params: Scope & { columnKey: string }): Promise<ColumnFilterMeta> => {
    if (columnMetaFailureKeys.has(params.columnKey)) {
      throw new Error(`simulated IPC failure for ${params.columnKey}`)
    }
    return {
      key: params.columnKey,
      dataType: 'numeric',
      distinctCount: 5,
      min: 0,
      max: params.caseId ?? 100
    }
  }
)

const callsFor = (columnKey: string): number =>
  columnMeta.mock.calls.filter(([params]) => params.columnKey === columnKey).length

const vuetify = createVuetify({ components, directives })
const mounted: VueWrapper[] = []
let pinia: Pinia

async function mountComponent(
  props: {
    scope?: Scope
    modelValue?: Record<string, { operator: string; value: unknown; includeEmpty?: boolean }>
  } = {}
): Promise<VueWrapper> {
  const wrapper = mount(ExtensionColumnFilters, {
    global: { plugins: [vuetify, ...queryPlugins(pinia)] },
    props: {
      scope: props.scope ?? { caseId: 1 },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      modelValue: (props.modelValue ?? {}) as any
    }
  })
  mounted.push(wrapper)
  await flushPromises()
  return wrapper
}

/** Open the first section so its column controls mount and load. */
async function openFirstSection(wrapper: VueWrapper): Promise<void> {
  await wrapper.findComponent({ name: 'VExpansionPanelTitle' }).trigger('click')
  await flushPromises()
}

const firstControlMeta = (wrapper: VueWrapper): ColumnFilterMeta | undefined =>
  wrapper.findComponent({ name: 'NumericRangeControl' }).props('meta')

describe('ExtensionColumnFilters', () => {
  beforeEach(() => {
    typesPresentResponse.current = new Set()
    columnMetaFailureKeys.clear()
    vi.clearAllMocks()
    Object.assign(window, { api: { variants: { typesPresent, columnMeta } } })
    pinia = createQueryPinia()
  })

  afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount()
  })

  it('renders empty-state message when no extension types are present', async () => {
    typesPresentResponse.current = new Set(['snv'])
    const wrapper = await mountComponent()
    expect(wrapper.text()).toContain('No structural variants')
    // No accordion sections
    expect(wrapper.findAllComponents({ name: 'VExpansionPanel' }).length).toBe(0)
  })

  it('renders CNV section only when scope contains CNV variants', async () => {
    typesPresentResponse.current = new Set(['cnv'])
    const wrapper = await mountComponent()
    const panels = wrapper.findAllComponents({ name: 'VExpansionPanel' })
    expect(panels.length).toBe(1)
    // Section title contains CNV
    expect(wrapper.text()).toContain('CNV')
    expect(wrapper.text()).not.toContain('STR')
  })

  it('renders all three sections when scope contains sv, cnv, and str variants', async () => {
    typesPresentResponse.current = new Set(['sv', 'cnv', 'str'])
    const wrapper = await mountComponent()
    const panels = wrapper.findAllComponents({ name: 'VExpansionPanel' })
    expect(panels.length).toBe(3)
    const text = wrapper.text()
    expect(text).toContain('SV')
    expect(text).toContain('CNV')
    expect(text).toContain('STR')
  })

  it('builds STR-specific sections with the registry labels', async () => {
    typesPresentResponse.current = new Set(['str'])
    const wrapper = await mountComponent()
    // Inspect the computed typeSections directly by looking at the
    // component's VNode tree. Collapsed v-expansion-panel bodies don't
    // render their text into the DOM until opened, so we read the sections
    // via the exposed component data instead.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const vm = wrapper.vm as any
    const sections = vm.typeSections as Array<{
      typeKey: string
      columns: Array<{ dottedKey: string; label: string; kind: string }>
    }>
    expect(sections.length).toBe(1)
    expect(sections[0].typeKey).toBe('str')
    const labels = sections[0].columns.map((c) => c.label)
    expect(labels).toContain('Repeat length')
    expect(labels).toContain('Reference copies')
    expect(labels).toContain('Disease')
  })

  it('emits update:modelValue with a new numeric filter when a control updates', async () => {
    typesPresentResponse.current = new Set(['cnv'])
    const wrapper = await mountComponent({
      scope: { caseId: 42 },
      modelValue: {}
    })
    await openFirstSection(wrapper)

    // Grab the first NumericRangeControl and simulate an update.
    const numericControl = wrapper.findComponent({ name: 'NumericRangeControl' })
    expect(numericControl.exists()).toBe(true)
    numericControl.vm.$emit('update:modelValue', {
      operator: '>=',
      value: 3,
      includeEmpty: false
    })
    await flushPromises()
    const events = wrapper.emitted('update:modelValue')
    expect(events).toBeTruthy()
    const latest = events?.at(-1)?.[0] as Record<string, unknown>
    expect(latest).toBeDefined()
    // The key should be one of the cnv.* columns (first numeric column is
    // cnv.copy_number per the registry ordering).
    const keys = Object.keys(latest)
    expect(keys.length).toBeGreaterThan(0)
    expect(keys[0].startsWith('cnv.')).toBe(true)
    expect(latest[keys[0]]).toEqual({ operator: '>=', value: 3, includeEmpty: false })
  })

  it('emits update:modelValue with the key removed when a control clears', async () => {
    typesPresentResponse.current = new Set(['cnv'])
    const wrapper = await mountComponent({
      scope: { caseId: 42 },
      modelValue: {
        'cnv.copy_number': { operator: '>=', value: 3, includeEmpty: false }
      }
    })
    await openFirstSection(wrapper)

    const numericControl = wrapper.findComponent({ name: 'NumericRangeControl' })
    expect(numericControl.exists()).toBe(true)
    numericControl.vm.$emit('update:modelValue', undefined)
    await flushPromises()
    const events = wrapper.emitted('update:modelValue')
    expect(events).toBeTruthy()
    const latest = events?.at(-1)?.[0] as Record<string, unknown>
    expect(latest).toEqual({})
  })

  it('asks for no metadata while the scope is empty', async () => {
    typesPresentResponse.current = new Set(['cnv'])
    await mountComponent({ scope: { caseIds: [] } })

    expect(typesPresent).not.toHaveBeenCalled()
    expect(columnMeta).not.toHaveBeenCalled()
  })

  it('forwards a cohort scope as case ids', async () => {
    typesPresentResponse.current = new Set(['cnv'])
    const wrapper = await mountComponent({ scope: { caseIds: [3, 1, 2] } })
    await openFirstSection(wrapper)

    expect(typesPresent).toHaveBeenCalledWith({ caseId: undefined, caseIds: [3, 1, 2] })
    expect(columnMeta).toHaveBeenCalledWith(
      expect.objectContaining({ caseIds: [3, 1, 2], columnKey: 'cnv.copy_number' })
    )
  })

  it('loads each column once, shared by every drawer showing the same scope', async () => {
    typesPresentResponse.current = new Set(['cnv'])
    const first = await mountComponent({ scope: { caseId: 42 } })
    const second = await mountComponent({ scope: { caseId: 42 } })
    await openFirstSection(first)
    await openFirstSection(second)

    expect(typesPresent).toHaveBeenCalledTimes(1)
    expect(callsFor('cnv.copy_number')).toBe(1)
    expect(firstControlMeta(second)?.max).toBe(42)
  })

  it('does not ask again for a column whose metadata failed to load', async () => {
    // Regression: a failed load used to be retried on every render.
    typesPresentResponse.current = new Set(['cnv'])
    columnMetaFailureKeys.add('cnv.copy_number')
    const wrapper = await mountComponent({ scope: { caseId: 42 } })
    await openFirstSection(wrapper)
    expect(callsFor('cnv.copy_number')).toBe(1)

    for (let i = 0; i < 3; i++) {
      await wrapper.setProps({
        scope: { caseId: 42 },
        modelValue: { 'dummy.key': { operator: '>=', value: i } }
      })
      await flushPromises()
    }

    expect(callsFor('cnv.copy_number')).toBe(1)
    expect(firstControlMeta(wrapper)).toBeUndefined()
  })

  it("shows only the new scope's metadata after switching to another case", async () => {
    typesPresentResponse.current = new Set(['cnv'])
    const wrapper = await mountComponent({ scope: { caseId: 1 } })
    await openFirstSection(wrapper)
    expect(firstControlMeta(wrapper)?.max).toBe(1)

    await wrapper.setProps({ scope: { caseId: 2 } })
    expect(firstControlMeta(wrapper)).toBeUndefined()

    await flushPromises()
    expect(firstControlMeta(wrapper)?.max).toBe(2)
  })

  it('never shows the previous scope when its response arrives last', async () => {
    typesPresentResponse.current = new Set(['cnv'])
    const wrapper = await mountComponent({ scope: { caseId: 1 } })
    let resolveSlow: (meta: ColumnFilterMeta) => void = () => {}
    columnMeta.mockImplementationOnce(
      () => new Promise<ColumnFilterMeta>((resolve) => (resolveSlow = resolve))
    )
    await openFirstSection(wrapper)

    await wrapper.setProps({ scope: { caseId: 2 } })
    await flushPromises()
    resolveSlow({ key: 'cnv.copy_number', dataType: 'numeric', distinctCount: 1, min: 0, max: 1 })
    await flushPromises()

    expect(firstControlMeta(wrapper)?.max).toBe(2)
  })

  it('asks again for a failed column once the scope changes', async () => {
    typesPresentResponse.current = new Set(['cnv'])
    columnMetaFailureKeys.add('cnv.copy_number')
    const wrapper = await mountComponent({ scope: { caseId: 1 } })
    await openFirstSection(wrapper)

    await wrapper.setProps({ scope: { caseId: 2 } })
    await flushPromises()

    expect(callsFor('cnv.copy_number')).toBe(2)
  })

  it('does not refetch when an equal scope object is passed again', async () => {
    typesPresentResponse.current = new Set(['cnv'])
    const wrapper = await mountComponent({ scope: { caseId: 1 } })
    await openFirstSection(wrapper)
    const calls = columnMeta.mock.calls.length

    await wrapper.setProps({ scope: { caseId: 1 } })
    await flushPromises()

    expect(columnMeta).toHaveBeenCalledTimes(calls)
    expect(typesPresent).toHaveBeenCalledTimes(1)
  })

  it('reloads the metadata after an import or delete', async () => {
    typesPresentResponse.current = new Set(['cnv'])
    const wrapper = await mountComponent({ scope: { caseId: 1 } })
    await openFirstSection(wrapper)

    await invalidateServerData('data-changed')
    await flushPromises()

    expect(callsFor('cnv.copy_number')).toBe(2)
    expect(typesPresent).toHaveBeenCalledTimes(2)
  })

  it("does not show another database's metadata for the same case id", async () => {
    typesPresentResponse.current = new Set(['cnv'])
    const wrapper = await mountComponent({ scope: { caseId: 1 } })
    await openFirstSection(wrapper)
    columnMeta.mockImplementation(async ({ columnKey }) => ({
      key: columnKey,
      dataType: 'numeric',
      distinctCount: 1,
      min: 0,
      max: 999
    }))

    useDatabaseStore().revision++
    await invalidateServerData('database-switch')
    await flushPromises()

    expect(firstControlMeta(wrapper)?.max).toBe(999)
  })
})
