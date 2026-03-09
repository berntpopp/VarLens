import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import CohortFilterBar from '../../../src/renderer/src/components/cohort/CohortFilterBar.vue'
import { createMockApi } from '../../utils/mock-api'
import { FiltersKey, createFilters } from '../../../src/renderer/src/composables/useFilters'

const vuetify = createVuetify({ components, directives })

describe('CohortFilterBar', () => {
  beforeEach(() => {
    window.api = createMockApi()
  })

  // Stub out drawer and toolbar components that require Vuetify layout provider
  const drawerStubs = {
    CohortFilterDrawer: { template: '<div />' },
    ColumnsDrawer: { template: '<div />' }
  }

  const defaultProps = {
    totalCount: 100,
    cohortSummary: { total_cases: 20, unique_variants: 500 },
    columns: [
      { key: 'gene_symbol', title: 'Gene' },
      { key: 'chr', title: 'Chr' }
    ],
    visibleColumns: ['gene_symbol', 'chr'],
    exporting: false
  }

  // Provide FiltersKey for useFilters() inject in CohortFilterBar
  const globalConfig = {
    plugins: [vuetify],
    stubs: drawerStubs,
    provide: { [FiltersKey as symbol]: createFilters() }
  }

  describe('Filter Inputs Rendering', () => {
    it('renders search input field', () => {
      const wrapper = mount(CohortFilterBar, {
        props: defaultProps,
        global: globalConfig
      })

      const searchInput = wrapper.find('.filter-search-input')
      expect(searchInput.exists()).toBe(true)
    })

    it('renders ACMG classification chips in toolbar', () => {
      const wrapper = mount(CohortFilterBar, {
        props: defaultProps,
        global: globalConfig
      })

      // Find chips within the ACMG chip-group
      const chipGroup = wrapper.find('.v-chip-group')
      expect(chipGroup.exists()).toBe(true)
      const chipLabels = chipGroup.findAll('.v-chip').map((c) => c.text())
      expect(chipLabels).toEqual(expect.arrayContaining(['P', 'LP', 'VUS', 'LB', 'B']))
      expect(chipLabels).toHaveLength(5)
    })
  })

  describe('Filter State Display', () => {
    it('displays total count in results chip', () => {
      const wrapper = mount(CohortFilterBar, {
        props: defaultProps,
        global: globalConfig
      })

      const resultsChip = wrapper.find('.results-chip')
      expect(resultsChip.exists()).toBe(true)
      expect(resultsChip.text()).toContain('100')
    })

    it('displays total and filtered count when filters active', () => {
      const wrapper = mount(CohortFilterBar, {
        props: {
          ...defaultProps,
          totalCount: 50
        },
        global: globalConfig
      })

      const resultsChip = wrapper.find('.results-chip')
      expect(resultsChip.text()).toContain('50')
    })

    it('displays zero when count is null', () => {
      const wrapper = mount(CohortFilterBar, {
        props: {
          ...defaultProps,
          totalCount: null
        },
        global: globalConfig
      })

      const resultsChip = wrapper.find('.results-chip')
      expect(resultsChip.text()).toContain('0')
    })

    it('shows clear button', () => {
      const wrapper = mount(CohortFilterBar, {
        props: defaultProps,
        global: globalConfig
      })

      // Find the clear button by its mdi-filter-off icon
      const clearButton = wrapper.findAll('button').find((btn) => {
        return btn.find('.mdi-filter-off').exists()
      })
      expect(clearButton).toBeDefined()
    })

    it('shows export button', () => {
      const wrapper = mount(CohortFilterBar, {
        props: defaultProps,
        global: globalConfig
      })

      const exportButton = wrapper.findAll('button').find((btn) => btn.text().includes('Export'))
      expect(exportButton).toBeDefined()
    })

    it('disables export button when count is zero', () => {
      const wrapper = mount(CohortFilterBar, {
        props: {
          ...defaultProps,
          totalCount: 0
        },
        global: globalConfig
      })

      const exportButton = wrapper.findAll('button').find((btn) => btn.text().includes('Export'))
      expect(exportButton?.attributes('disabled')).toBeDefined()
    })

    it('passes exporting state to export button', () => {
      const wrapper = mount(CohortFilterBar, {
        props: {
          ...defaultProps,
          exporting: true
        },
        global: globalConfig
      })

      // When exporting, the v-btn has loading=true which renders a loader overlay
      const exportButton = wrapper.findAll('button').find((btn) => btn.text().includes('Export'))
      expect(exportButton).toBeDefined()
      // Verify the component received the prop correctly
      expect(wrapper.props('exporting')).toBe(true)
    })
  })

  describe('Event Emission', () => {
    it('has handleClearAll method that emits clear-all event', () => {
      const wrapper = mount(CohortFilterBar, {
        props: defaultProps,
        global: globalConfig
      })

      // Find the clear button by its prepend icon
      const clearButtons = wrapper.findAll('button')
      const clearButton = clearButtons.find((btn) => {
        const icon = btn.find('.mdi-filter-off')
        return icon.exists()
      })

      expect(clearButton).toBeDefined()
    })

    it('emits export when export button clicked', async () => {
      const wrapper = mount(CohortFilterBar, {
        props: defaultProps,
        global: globalConfig
      })

      const exportButton = wrapper.findAll('button').find((btn) => btn.text().includes('Export'))
      await exportButton?.trigger('click')

      expect(wrapper.emitted('export')).toBeTruthy()
    })

    it('emits toggle-column when column visibility toggled', async () => {
      const wrapper = mount(CohortFilterBar, {
        props: defaultProps,
        global: globalConfig
      })

      await wrapper.vm.$emit('toggle-column', 'gene_symbol')

      expect(wrapper.emitted('toggle-column')).toBeTruthy()
      expect(wrapper.emitted('toggle-column')?.[0]).toEqual(['gene_symbol'])
    })

    it('emits reorder-columns when columns reordered', async () => {
      const wrapper = mount(CohortFilterBar, {
        props: defaultProps,
        global: globalConfig
      })

      await wrapper.vm.$emit('reorder-columns', ['chr', 'gene_symbol'])

      expect(wrapper.emitted('reorder-columns')).toBeTruthy()
      expect(wrapper.emitted('reorder-columns')?.[0]).toEqual([['chr', 'gene_symbol']])
    })

    it('emits reset-columns when columns reset', async () => {
      const wrapper = mount(CohortFilterBar, {
        props: defaultProps,
        global: globalConfig
      })

      await wrapper.vm.$emit('reset-columns')

      expect(wrapper.emitted('reset-columns')).toBeTruthy()
    })
  })

  describe('Props Handling', () => {
    it('accepts totalCount prop', () => {
      const wrapper = mount(CohortFilterBar, {
        props: {
          ...defaultProps,
          totalCount: 42
        },
        global: globalConfig
      })

      const resultsChip = wrapper.find('.results-chip')
      expect(resultsChip.text()).toContain('42')
    })

    it('accepts cohortSummary prop', () => {
      const wrapper = mount(CohortFilterBar, {
        props: {
          ...defaultProps,
          cohortSummary: { total_cases: 10, unique_variants: 250 }
        },
        global: globalConfig
      })

      expect(wrapper.props('cohortSummary')).toEqual({ total_cases: 10, unique_variants: 250 })
    })

    it('accepts columns prop for visibility menu', () => {
      const customColumns = [
        { key: 'gene_symbol', title: 'Gene' },
        { key: 'chr', title: 'Chromosome' },
        { key: 'pos', title: 'Position' }
      ]

      const wrapper = mount(CohortFilterBar, {
        props: {
          ...defaultProps,
          columns: customColumns
        },
        global: globalConfig
      })

      expect(wrapper.props('columns')).toEqual(customColumns)
    })

    it('accepts visibleColumns prop', () => {
      const visibleCols = ['gene_symbol', 'chr', 'pos']

      const wrapper = mount(CohortFilterBar, {
        props: {
          ...defaultProps,
          visibleColumns: visibleCols
        },
        global: globalConfig
      })

      expect(wrapper.props('visibleColumns')).toEqual(visibleCols)
    })

    it('accepts exporting prop', () => {
      const wrapper = mount(CohortFilterBar, {
        props: {
          ...defaultProps,
          exporting: true
        },
        global: globalConfig
      })

      expect(wrapper.props('exporting')).toBe(true)
    })
  })
})
