import { describe, expect, it, vi } from 'vitest'
import type { Ref } from 'vue'
import { createAppState } from '../../../src/renderer/src/composables/useAppState'
import { useCarriers } from '../../../src/renderer/src/composables/useCarriers'
import { useTags } from '../../../src/renderer/src/composables/useTags'
import { useVariantColumnMeta } from '../../../src/renderer/src/composables/useVariantColumnMeta'
import { createMockApi } from '../../utils/mock-api'

describe('createAppState', () => {
  it('selects a case through an explicit shell action', () => {
    const state = createAppState()

    state.activeTab.value = 'cohort'

    state.selectCase({
      caseId: 7,
      caseName: 'Case 7',
      variantCount: 12,
      createdAt: 123
    })

    expect(state.selectedCaseId.value).toBe(7)
    expect(state.selectedCaseName.value).toBe('Case 7')
    expect(state.selectedVariantCount.value).toBe(12)
    expect(state.selectedCreatedAt.value).toBe(123)
    expect(state.activeTab.value).toBe('case')
  })

  it('opens the import dialog through the handler the shell registered', () => {
    const state = createAppState()
    let opened = 0

    // No handler yet (shell not mounted): a no-op, never a throw.
    expect(() => state.openImport()).not.toThrow()

    state.setImportHandler(() => {
      opened++
    })
    state.openImport()

    expect(opened).toBe(1)
  })

  it('switches tabs through an explicit shell action', () => {
    const state = createAppState()

    state.setActiveTab('cohort')

    expect(state.activeTab.value).toBe('cohort')
  })

  it('clears case selection and case filters through explicit shell actions', () => {
    const state = createAppState()

    state.selectedCaseId.value = 7
    state.currentFilters.value = { gene_symbol: 'BRCA1' }
    state.hasSort.value = true

    state.clearSelectedCase()
    state.resetCaseFilters()

    expect(state.selectedCaseId.value).toBeNull()
    expect(state.currentFilters.value).toEqual({})
    expect(state.hasSort.value).toBe(false)
  })

  it('returns to case home through an explicit shell action', () => {
    const state = createAppState()

    state.selectedCaseId.value = 7
    state.selectedCaseName.value = 'Case 7'
    state.activeTab.value = 'cohort'
    state.sidebarOpen.value = false

    state.returnToCaseHome()

    expect(state.selectedCaseId.value).toBeNull()
    expect(state.selectedCaseName.value).toBe('')
    expect(state.activeTab.value).toBe('case')
    expect(state.sidebarOpen.value).toBe(true)
  })

  it('updates case count and data generation through explicit shell actions', () => {
    const state = createAppState()

    state.setCaseCount(12)
    state.incrementDataGeneration()

    expect(state.caseCount.value).toBe(12)
    expect(state.dataGeneration.value).toBe(1)
  })

  it('closes the sidebar through an explicit shell action', () => {
    const state = createAppState()

    state.sidebarOpen.value = true

    state.closeSidebar()

    expect(state.sidebarOpen.value).toBe(false)
  })

  it('resets case-scoped shell state together', () => {
    const state = createAppState()

    state.selectedCaseId.value = 7
    state.selectedCaseName.value = 'Case 7'
    state.selectedVariantCount.value = 12
    state.selectedCreatedAt.value = 123
    state.currentFilters.value = { gene_symbol: 'BRCA1' }
    state.filteredCount.value = 5
    state.totalCount.value = 20
    state.hasSort.value = true

    state.resetCaseContext()

    expect(state.selectedCaseId.value).toBeNull()
    expect(state.selectedCaseName.value).toBe('')
    expect(state.selectedVariantCount.value).toBe(0)
    expect(state.selectedCreatedAt.value).toBe(0)
    expect(state.currentFilters.value).toEqual({})
    expect(state.filteredCount.value).toBe(0)
    expect(state.totalCount.value).toBe(0)
    expect(state.hasSort.value).toBe(false)
  })

  it('resets shell-owned state for a database switch in one call', () => {
    const state = createAppState()

    state.selectedCaseId.value = 7
    state.selectedCaseName.value = 'Case 7'
    state.selectedVariantCount.value = 12
    state.selectedCreatedAt.value = 123
    state.currentFilters.value = { gene_symbol: 'BRCA1' }
    state.filteredCount.value = 5
    state.totalCount.value = 20
    state.hasSort.value = true
    state.activeTab.value = 'cohort'
    state.panelOpen.value = true
    state.selectedPanelVariant.value = { id: 'variant-1' } as never

    const carriers = useCarriers()
    carriers.carrierMap.value.set('chr1-100-A-T', [{ case_name: 'case1', gt_num: '0/1' }])
    carriers.expandedRows.value = ['chr1-100-A-T']

    expect(state.dataGeneration.value).toBe(0)

    state.resetForDatabaseSwitch()

    expect(state.dataGeneration.value).toBe(1)
    expect(carriers.carrierMap.value.size).toBe(0)
    expect(carriers.expandedRows.value).toEqual([])
    expect(state.selectedCaseId.value).toBeNull()
    expect(state.selectedCaseName.value).toBe('')
    expect(state.selectedVariantCount.value).toBe(0)
    expect(state.selectedCreatedAt.value).toBe(0)
    expect(state.currentFilters.value).toEqual({})
    expect(state.filteredCount.value).toBe(0)
    expect(state.totalCount.value).toBe(0)
    expect(state.hasSort.value).toBe(false)
    expect(state.activeTab.value).toBe('case')
    expect(state.panelOpen.value).toBe(false)
    expect(state.selectedPanelVariant.value).toBeNull()
  })

  it('drops database-scoped caches on a database switch', async () => {
    // Case and variant ids restart per database, so every cache keyed by them
    // would otherwise serve the previous database's data.
    const api = createMockApi()
    api.tags.list = vi.fn().mockResolvedValue([{ id: 1, name: 'Review', color: '#F44336' }])
    api.tags.getVariantTags = vi
      .fn()
      .mockResolvedValue([{ id: 1, name: 'Review', color: '#F44336' }])
    window.api = api

    const tags = useTags()
    await tags.loadTags()
    await tags.loadVariantTags(1, 10)
    const columnMeta = useVariantColumnMeta()
    ;(columnMeta.variantTypesPresent as Ref<Record<string, Set<string>>>).value = {
      'case:1': new Set(['sv'])
    }
    const epochBefore = columnMeta.cacheEpoch.value

    createAppState().resetForDatabaseSwitch()

    expect(tags.getTags()).toEqual([])
    expect(tags.getVariantTags(1, 10)).toEqual([])
    expect(columnMeta.variantTypesPresent.value).toEqual({})
    expect(columnMeta.cacheEpoch.value).toBe(epochBefore + 1)
  })
})
