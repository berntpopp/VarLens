import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'

import VcfImportDialog from '../../../src/renderer/src/components/import/VcfImportDialog.vue'
import { AppStateKey, createAppState } from '../../../src/renderer/src/composables/useAppState'
import { createMockApi, type MockApi } from '../../utils/mock-api'

const vuetify = createVuetify({ components, directives })

function dispatchFileDrop(target: Element, files: File[]): void {
  const event = new Event('drop', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'dataTransfer', { value: { files } })
  target.dispatchEvent(event)
}

describe('VcfImportDialog dropped-file provenance', () => {
  let wrapper: VueWrapper<InstanceType<typeof VcfImportDialog>>
  let mockApi: MockApi

  beforeEach(() => {
    const pinia = createPinia()
    setActivePinia(pinia)
    mockApi = createMockApi()
    window.api = mockApi as unknown as typeof window.api
    wrapper = mount(VcfImportDialog, {
      props: { open: true },
      global: {
        plugins: [vuetify, pinia],
        provide: { [AppStateKey as symbol]: createAppState() }
      },
      attachTo: document.body
    })
  })

  afterEach(() => {
    wrapper.unmount()
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('enrolls genuine dropped Files before sending their returned paths to preview', async () => {
    const droppedFile = new File(['##fileformat=VCFv4.2\n'], 'sample.vcf')
    mockApi.import.enrollDroppedFiles.mockResolvedValue(['/trusted/sample.vcf'])
    mockApi.import.vcfMultiPreview.mockResolvedValue({
      files: [],
      siblingBedFiles: [],
      suggestedCaseName: 'sample'
    })
    await flushPromises()

    const dropZone = document.body.querySelector('.drop-zone')
    expect(dropZone).not.toBeNull()
    dispatchFileDrop(dropZone!, [droppedFile])
    await flushPromises()

    expect(mockApi.import.enrollDroppedFiles).toHaveBeenCalledWith([droppedFile])
    expect(mockApi.import.vcfMultiPreview).toHaveBeenCalledWith(['/trusted/sample.vcf'])
  })

  it('shows a recoverable error when dropped-file provenance enrollment fails', async () => {
    const droppedFile = new File(['##fileformat=VCFv4.2\n'], 'sample.vcf')
    mockApi.import.enrollDroppedFiles.mockRejectedValue(new Error('native path unavailable'))
    await flushPromises()

    const dropZone = document.body.querySelector('.drop-zone')
    expect(dropZone).not.toBeNull()
    dispatchFileDrop(dropZone!, [droppedFile])
    await flushPromises()

    expect(document.body.textContent).toContain('File drop failed: native path unavailable')
    expect(mockApi.import.vcfMultiPreview).not.toHaveBeenCalled()
  })
})
