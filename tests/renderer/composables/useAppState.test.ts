import { describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { createAppState } from '../../../src/renderer/src/composables/useAppState'
import { invalidateServerData } from '../../../src/renderer/src/queries/invalidation'

vi.mock('../../../src/renderer/src/queries/invalidation', () => ({
  invalidateServerData: vi.fn().mockResolvedValue(undefined)
}))

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

    expect(state.dataGeneration.value).toBe(0)

    state.resetForDatabaseSwitch()

    expect(state.dataGeneration.value).toBe(1)
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

  it('tells the query cache about a database switch', () => {
    createAppState().resetForDatabaseSwitch()

    expect(invalidateServerData).toHaveBeenCalledExactlyOnceWith('database-switch')
  })

  it('closes the details panel when the selected case changes', () => {
    const state = createAppState()
    state.selectCase({ caseId: 1, caseName: 'Case 1' })
    state.selectedPanelVariant.value = { id: 5, case_id: 1 } as never
    state.panelOpen.value = true

    // Re-selecting the same case keeps the panel.
    state.selectCase({ caseId: 1, caseName: 'Case 1' })
    expect(state.panelOpen.value).toBe(true)

    // Left open, the old case's variant would be annotated under the new case id.
    state.selectCase({ caseId: 2, caseName: 'Case 2' })
    expect(state.panelOpen.value).toBe(false)
    expect(state.selectedPanelVariant.value).toBeNull()

    state.selectedPanelVariant.value = { id: 6, case_id: 2 } as never
    state.panelOpen.value = true
    state.clearSelectedCase()
    expect(state.panelOpen.value).toBe(false)
    expect(state.selectedPanelVariant.value).toBeNull()
  })

  describe('unsaved ACMG draft guard', () => {
    const variant = (id: number) => ({ id }) as never

    function openWithDraft(answer: Promise<boolean> | null) {
      const state = createAppState()
      state.selectedPanelVariant.value = variant(1)
      state.panelOpen.value = true
      const guard = vi.fn(() => answer)
      state.setPanelLeaveGuard(guard)
      return { state, guard }
    }

    it('holds a selection change, close, tab and case switch until the prompt is answered', async () => {
      let answer!: (leave: boolean) => void
      const { state, guard } = openWithDraft(new Promise<boolean>((r) => (answer = r)))

      state.selectedPanelVariant.value = variant(2)
      state.panelOpen.value = false
      state.setActiveTab('cohort')
      state.selectCase({ caseId: 9, caseName: 'Case 9' })

      expect(guard).toHaveBeenCalledTimes(1)
      expect(state.selectedPanelVariant.value).toEqual({ id: 1 })
      expect(state.panelOpen.value).toBe(true)
      expect(state.activeTab.value).toBe('case')
      expect(state.selectedCaseName.value).toBe('')

      // Apply (after a successful save) and Discard both answer "leave".
      answer(true)
      await flushPromises()

      expect(state.activeTab.value).toBe('case')
      expect(state.selectedCaseId.value).toBe(9)
      expect(state.panelOpen.value).toBe(false)
    })

    it('Apply / Discard let the held selection change through', async () => {
      const { state } = openWithDraft(Promise.resolve(true))

      state.selectedPanelVariant.value = variant(2)
      expect(state.selectedPanelVariant.value).toEqual({ id: 1 })
      await flushPromises()

      expect(state.selectedPanelVariant.value).toEqual({ id: 2 })
      expect(state.panelOpen.value).toBe(true)
    })

    it('Cancel keeps the panel on the current variant', async () => {
      const { state } = openWithDraft(Promise.resolve(false))

      state.selectedPanelVariant.value = variant(2)
      await flushPromises()

      expect(state.selectedPanelVariant.value).toEqual({ id: 1 })
      expect(state.panelOpen.value).toBe(true)

      // The next attempt asks again instead of staying queued.
      state.panelOpen.value = false
      expect(state.panelOpen.value).toBe(true)
    })

    it('gives a route guard the same answer as the held writes', async () => {
      let answer!: (leave: boolean) => void
      const { state, guard } = openWithDraft(new Promise<boolean>((r) => (answer = r)))

      state.panelOpen.value = false
      const route = state.confirmPanelLeave()
      answer(false)

      expect(await route).toBe(false)
      expect(guard).toHaveBeenCalledTimes(1)
      expect(state.panelOpen.value).toBe(true)
    })

    it('changes the selection at once when there is no draft', () => {
      const { state, guard } = openWithDraft(null)

      state.selectedPanelVariant.value = variant(2)

      expect(guard).toHaveBeenCalledTimes(1)
      expect(state.selectedPanelVariant.value).toEqual({ id: 2 })
      expect(state.confirmPanelLeave()).toBeNull()
    })

    it('a deleted case is cleared without asking, and what the prompt held is dropped', async () => {
      let answer!: (leave: boolean) => void
      const { state, guard } = openWithDraft(new Promise<boolean>((r) => (answer = r)))
      state.selectedCaseId.value = 7
      state.selectCase({ caseId: 9, caseName: 'Case 9' }) // held by the open prompt
      guard.mockClear()

      state.closePanelWithoutAsking()
      state.resetCaseContext()

      expect(guard).not.toHaveBeenCalled()
      expect(state.panelOpen.value).toBe(false)
      expect(state.selectedPanelVariant.value).toBeNull()
      expect(state.selectedCaseId.value).toBeNull()

      answer(true)
      await flushPromises()
      expect(state.selectedCaseId.value).toBeNull()
    })

    it('a database switch closes the panel without asking', () => {
      const { state, guard } = openWithDraft(new Promise<boolean>(() => {}))

      state.resetForDatabaseSwitch()

      expect(guard).not.toHaveBeenCalled()
      expect(state.panelOpen.value).toBe(false)
      expect(state.selectedPanelVariant.value).toBeNull()
    })
  })
})
