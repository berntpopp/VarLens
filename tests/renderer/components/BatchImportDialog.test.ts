import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'

import BatchImportDialog from '../../../src/renderer/src/components/BatchImportDialog.vue'
import { createMockApi, type MockApi } from '../../utils/mock-api'

const vuetify = createVuetify({ components, directives })

describe('BatchImportDialog ZIP ownership', () => {
  let wrapper: VueWrapper<InstanceType<typeof BatchImportDialog>>
  let mockApi: MockApi

  beforeEach(() => {
    const pinia = createPinia()
    setActivePinia(pinia)
    mockApi = createMockApi()
    window.api = mockApi as unknown as typeof window.api
    wrapper = mount(BatchImportDialog, {
      global: { plugins: [vuetify, pinia] },
      attachTo: document.body
    })
  })

  afterEach(() => {
    wrapper.unmount()
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('releases the exact ZIP extraction as soon as its import reaches a terminal result', async () => {
    mockApi.batchImport.selectZip.mockResolvedValue({
      filePath: '/selected/cases.zip',
      isEncrypted: false
    })
    mockApi.batchImport.extractZip.mockResolvedValue({
      files: ['/tmp/extraction/case.json'],
      errors: [],
      extractionId: 'extraction-owned-by-dialog'
    })
    mockApi.batchImport.checkDuplicates.mockResolvedValue({
      files: [
        {
          filePath: '/tmp/extraction/case.json',
          fileName: 'case.json',
          caseName: 'case',
          isDuplicate: false
        }
      ],
      duplicateCount: 0
    })
    mockApi.batchImport.start.mockResolvedValue({
      succeeded: 1,
      failed: 0,
      skipped: 0,
      cancelled: false,
      details: []
    })

    await wrapper.vm.show('zip')
    await flushPromises()
    const startButton = Array.from(document.body.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Start Import')
    )
    expect(startButton).toBeDefined()
    startButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushPromises()

    expect(mockApi.batchImport.cleanupZipTemp).toHaveBeenCalledTimes(1)
    expect(mockApi.batchImport.cleanupZipTemp).toHaveBeenCalledWith('extraction-owned-by-dialog')
  })
})
