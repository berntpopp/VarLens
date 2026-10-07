/**
 * Tests for AssociationConfigPanel.vue after the Task 13 migration to the
 * shared FilterState contract.
 *
 * These tests verify three things:
 * 1. The panel mounts cleanly (no composable wiring errors from createFilters).
 * 2. handleRun emits a `run` config whose `filters` object is in the
 *    FilterIpcParams shape (snake_case keys, only non-empty fields) and whose
 *    gene_list field is merged in from the panel-local parsedGeneList.
 * 3. FilterTypeNarrowingChip is mounted unconditionally, and
 *    ExtensionColumnFilters is mounted only when either group has cases.
 *
 * `useVariantColumnMeta` is mocked because ExtensionColumnFilters calls
 * `ensureTypesPresent`/`getColumnMeta` at mount, which would otherwise hit
 * window.api IPC that isn't available in a Vitest unit test environment.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import type { ColumnFilterMeta } from '../../../../src/shared/types/column-filters'

vi.mock('../../../../src/renderer/src/composables/useVariantColumnMeta', () => ({
  cacheKeyFor: (scope: { caseId?: number; caseIds?: number[] }): string => JSON.stringify(scope),
  useVariantColumnMeta: (): {
    getColumnMeta: (scope: unknown, key: string) => Promise<ColumnFilterMeta>
    ensureTypesPresent: (scope: unknown) => Promise<Set<string>>
    invalidate: () => void
    invalidateAll: () => void
    cacheEpoch: { value: number }
  } => ({
    cacheEpoch: { value: 0 },
    getColumnMeta: vi.fn(async (_scope, key: string) => ({
      key,
      dataType: 'numeric',
      distinctCount: 0,
      min: 0,
      max: 100
    })),
    ensureTypesPresent: vi.fn(async () => new Set<string>()),
    invalidate: vi.fn(),
    invalidateAll: vi.fn()
  })
}))

import AssociationConfigPanel from '../../../../src/renderer/src/components/association/AssociationConfigPanel.vue'

const vuetify = createVuetify({ components, directives })

interface FilterStateShape {
  maxGnomadAf: number | null
  minCadd: number | null
  consequences: string[]
  columnFilters: Record<string, unknown>
}

// Vue auto-unwraps refs exposed via defineExpose for template and vm access,
// so `vm.filters` is the FilterState object itself (not the wrapping ref).
interface PanelVm {
  groupAIds: number[]
  groupBIds: number[]
  filters: FilterStateShape
  geneListText: string
  selectedImpactPresets: number[]
  handleRun: () => void
  scopeCaseIds: number[]
}

function mountPanel(
  props: {
    allCases?: Array<{
      id: number
      name: string
      status: string | null
      sex: string | null
      cohortIds: number[]
    }>
    cohortGroups?: Array<{ id: number; name: string }>
    running?: boolean
    hasResults?: boolean
  } = {}
): ReturnType<typeof mount> {
  return mount(AssociationConfigPanel, {
    global: { plugins: [vuetify] },
    props: {
      allCases: props.allCases ?? [],
      cohortGroups: props.cohortGroups ?? [],
      running: props.running ?? false,
      hasResults: props.hasResults ?? false
    }
  })
}

describe('AssociationConfigPanel (post-migration to shared FilterState)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('mounts without errors', () => {
    const wrapper = mountPanel()
    expect(wrapper.exists()).toBe(true)
    // Shared FilterState is wired up — the filters ref exposed via
    // defineExpose must be present with its default empty shape.
    const vm = wrapper.vm as unknown as PanelVm
    expect(vm.filters.maxGnomadAf).toBeNull()
    expect(vm.filters.minCadd).toBeNull()
    expect(vm.filters.consequences).toEqual([])
    expect(vm.filters.columnFilters).toEqual({})
  })

  it('emits run config with filters in FilterIpcParams shape', async () => {
    const wrapper = mountPanel({
      allCases: [
        { id: 1, name: 'c1', status: null, sex: null, cohortIds: [] },
        { id: 2, name: 'c2', status: null, sex: null, cohortIds: [] },
        { id: 3, name: 'c3', status: null, sex: null, cohortIds: [] },
        { id: 4, name: 'c4', status: null, sex: null, cohortIds: [] }
      ]
    })

    const vm = wrapper.vm as unknown as PanelVm
    vm.groupAIds.push(1, 2)
    vm.groupBIds.push(3, 4)
    vm.filters.maxGnomadAf = 0.01
    vm.filters.minCadd = 20
    vm.filters.consequences = ['missense_variant']
    vm.geneListText = 'BRCA1, TP53'
    await wrapper.vm.$nextTick()

    vm.handleRun()

    const runEmit = wrapper.emitted('run')
    expect(runEmit).toBeTruthy()
    expect(runEmit!.length).toBe(1)

    const config = runEmit![0]![0] as {
      groupA_ids: number[]
      groupB_ids: number[]
      primary_test: string
      weight_scheme: string
      covariates: string[]
      filters: {
        gnomad_af_max?: number
        cadd_min?: number
        consequences?: string[]
        gene_list?: string[]
        column_filters?: Record<string, unknown>
      }
      max_threads: number
    }

    expect(config.groupA_ids).toEqual([1, 2])
    expect(config.groupB_ids).toEqual([3, 4])
    // buildIpcParams produces snake_case keys
    expect(config.filters.gnomad_af_max).toBe(0.01)
    expect(config.filters.cadd_min).toBe(20)
    expect(config.filters.consequences).toEqual(['missense_variant'])
    // gene_list is panel-local, merged into the IPC payload by handleRun
    expect(config.filters.gene_list).toEqual(['BRCA1', 'TP53'])
    // column_filters not present because filters.columnFilters is empty
    expect(config.filters.column_filters).toBeUndefined()
  })

  it('merges extension column filters into the IPC payload', async () => {
    const wrapper = mountPanel({
      allCases: [
        { id: 1, name: 'c1', status: null, sex: null, cohortIds: [] },
        { id: 2, name: 'c2', status: null, sex: null, cohortIds: [] }
      ]
    })

    const vm = wrapper.vm as unknown as PanelVm
    vm.groupAIds.push(1)
    vm.groupBIds.push(2)
    vm.filters.columnFilters = {
      'sv.length': { operator: 'gte', value: 1000 }
    }
    await wrapper.vm.$nextTick()

    vm.handleRun()

    const runEmit = wrapper.emitted('run')
    const config = runEmit![0]![0] as {
      filters: { column_filters?: Record<string, unknown> }
    }
    expect(config.filters.column_filters).toEqual({
      'sv.length': { operator: 'gte', value: 1000 }
    })
  })

  it('mounts FilterTypeNarrowingChip', async () => {
    const wrapper = mountPanel()
    await flushPromises()
    const chip = wrapper.findComponent({ name: 'FilterTypeNarrowingChip' })
    expect(chip.exists()).toBe(true)
  })

  it('does NOT mount ExtensionColumnFilters when both groups are empty', async () => {
    const wrapper = mountPanel()
    await flushPromises()
    const vm = wrapper.vm as unknown as PanelVm
    expect(vm.scopeCaseIds).toEqual([])
    const extFilters = wrapper.findComponent({ name: 'ExtensionColumnFilters' })
    expect(extFilters.exists()).toBe(false)
  })

  it('scopeCaseIds is the deduplicated union of group A and group B', async () => {
    const wrapper = mountPanel({
      allCases: [
        { id: 1, name: 'c1', status: null, sex: null, cohortIds: [] },
        { id: 2, name: 'c2', status: null, sex: null, cohortIds: [] },
        { id: 3, name: 'c3', status: null, sex: null, cohortIds: [] }
      ]
    })

    const vm = wrapper.vm as unknown as PanelVm
    vm.groupAIds.push(1, 2)
    vm.groupBIds.push(2, 3) // overlap on id=2
    await wrapper.vm.$nextTick()

    const union = [...vm.scopeCaseIds].sort((a, b) => a - b)
    expect(union).toEqual([1, 2, 3])
  })

  it('impact preset watcher merges consequences into shared filters', async () => {
    const wrapper = mountPanel()
    const vm = wrapper.vm as unknown as PanelVm

    // Start from a clean state
    expect(vm.filters.consequences).toEqual([])

    // Simulate the v-chip-group model update by invoking setProps on the
    // underlying ref via the chip. We use the reactive wrapper and emit
    // update:modelValue with a new array to trigger the watcher (watch on a
    // ref does not fire for in-place array mutations — it fires on identity
    // change, so we replace the value rather than pushing).
    const chipGroups = wrapper.findAllComponents({ name: 'VChipGroup' })
    // The first chip-group in the Variant Filters panel is the impact presets
    // (AF presets + CADD presets come after). Emit a selection of index 0
    // which corresponds to HIGH.
    await chipGroups[0]!.vm.$emit('update:modelValue', [0])
    await wrapper.vm.$nextTick()

    // Consequences should now be non-empty (truncating group has entries)
    expect(vm.filters.consequences.length).toBeGreaterThan(0)
  })

  it('impact preset deselection removes preset-derived consequences', async () => {
    const wrapper = mountPanel()
    const vm = wrapper.vm as unknown as PanelVm
    const chipGroups = wrapper.findAllComponents({ name: 'VChipGroup' })

    // Select HIGH → consequences populate with truncating group
    await chipGroups[0]!.vm.$emit('update:modelValue', [0])
    await wrapper.vm.$nextTick()
    const afterSelect = vm.filters.consequences.length
    expect(afterSelect).toBeGreaterThan(0)

    // Deselect all → consequences should be EMPTY (preset-derived entries
    // stripped, no manual non-preset entries exist in this scenario)
    await chipGroups[0]!.vm.$emit('update:modelValue', [])
    await wrapper.vm.$nextTick()
    expect(vm.filters.consequences).toEqual([])
  })

  it('impact preset preserves manually-added non-preset consequences on deselect', async () => {
    const wrapper = mountPanel()
    const vm = wrapper.vm as unknown as PanelVm

    // Seed the consequences with a non-preset value (simulating a manual
    // GroupedMultiSelect choice the user made before touching presets)
    vm.filters.consequences = ['synonymous_variant_manual_test_sentinel']
    await wrapper.vm.$nextTick()

    const chipGroups = wrapper.findAllComponents({ name: 'VChipGroup' })
    // Select HIGH → adds preset consequences but keeps the sentinel
    await chipGroups[0]!.vm.$emit('update:modelValue', [0])
    await wrapper.vm.$nextTick()
    expect(vm.filters.consequences).toContain('synonymous_variant_manual_test_sentinel')

    // Deselect HIGH → strips preset consequences but keeps the sentinel
    await chipGroups[0]!.vm.$emit('update:modelValue', [])
    await wrapper.vm.$nextTick()
    expect(vm.filters.consequences).toEqual(['synonymous_variant_manual_test_sentinel'])
  })

  it('AF preset deselection clears filters.maxGnomadAf', async () => {
    const wrapper = mountPanel()
    const vm = wrapper.vm as unknown as PanelVm
    const chipGroups = wrapper.findAllComponents({ name: 'VChipGroup' })

    // chipGroups[1] is the AF preset group (impact presets are [0])
    // Select the first AF preset (1% → 0.01)
    await chipGroups[1]!.vm.$emit('update:modelValue', 0)
    await wrapper.vm.$nextTick()
    expect(vm.filters.maxGnomadAf).toBe(0.01)

    // Deselect (undefined) → should clear to null
    await chipGroups[1]!.vm.$emit('update:modelValue', undefined)
    await wrapper.vm.$nextTick()
    expect(vm.filters.maxGnomadAf).toBeNull()
  })

  it('CADD preset deselection clears filters.minCadd', async () => {
    const wrapper = mountPanel()
    const vm = wrapper.vm as unknown as PanelVm
    const chipGroups = wrapper.findAllComponents({ name: 'VChipGroup' })

    // chipGroups[2] is the CADD preset group
    await chipGroups[2]!.vm.$emit('update:modelValue', 1) // '20' preset
    await wrapper.vm.$nextTick()
    expect(vm.filters.minCadd).toBe(20)

    // Deselect → clears to null
    await chipGroups[2]!.vm.$emit('update:modelValue', undefined)
    await wrapper.vm.$nextTick()
    expect(vm.filters.minCadd).toBeNull()
  })
})
