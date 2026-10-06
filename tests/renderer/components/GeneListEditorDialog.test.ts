import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'

import GeneListEditorDialog from '../../../src/renderer/src/components/case-data-info/GeneListEditorDialog.vue'
import { createMockApi } from '../../utils/mock-api'

const vuetify = createVuetify({ components, directives })
type TestWindow = Window & { api?: unknown }

/**
 * Gene lists filter variants by gene symbol, so a typo would silently match
 * nothing. The editor validates against the bundled gene reference and
 * refuses to save unknown symbols (parity audit: NOTAGENE1 was accepted).
 */
describe('GeneListEditorDialog symbol validation', () => {
  let api: ReturnType<typeof createMockApi>

  beforeEach(() => {
    vi.useFakeTimers()
    api = createMockApi()
    ;(window as TestWindow).api = api
    api.panels.validateSymbols.mockImplementation(async (symbols: string[]) =>
      symbols.map((input) =>
        input === 'NOTAGENE1'
          ? { input, status: 'unknown' }
          : { input, status: 'approved', symbol: input, hgncId: 'HGNC:1' }
      )
    )
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function mountDialog() {
    return mount(GeneListEditorDialog, {
      props: { modelValue: false, geneLists: [], editGeneListId: null },
      global: { plugins: [vuetify] },
      attachTo: document.body
    })
  }

  it('flags unknown symbols, disables Save and never writes them', async () => {
    const wrapper = mountDialog()
    await wrapper.setProps({ modelValue: true })
    const vm = wrapper.vm as unknown as {
      geneListName: string
      geneListGenesText: string
      saveGeneList: () => Promise<void>
    }
    vm.geneListName = 'Typos'
    vm.geneListGenesText = 'BRCA1\nNOTAGENE1'
    await flushPromises()
    vi.advanceTimersByTime(500)
    await flushPromises()

    const unknown = document.body.querySelector('[data-testid="gene-list-unknown"]')
    expect(unknown?.textContent).toContain('NOTAGENE1')
    expect(document.body.querySelector('[data-testid="gene-list-count"]')?.textContent).toContain(
      '1 of 2 gene(s) recognized'
    )

    await vm.saveGeneList()
    expect(api.geneLists.create).not.toHaveBeenCalled()
    expect(api.geneLists.setGenes).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})
