import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import { afterEach, describe, expect, it, vi } from 'vitest'
import BatchImportDialog from '../../../src/renderer/src/components/BatchImportDialog.vue'
import { createMockApi } from '../../utils/mock-api'
import type { BatchResult } from '../../../src/shared/types/api'

const vuetify = createVuetify({ components, directives })

interface BatchImportDialogVm {
  selectedFilePaths: string[]
  fileCount: number
  confirmAndStartImport: () => Promise<void>
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

describe('BatchImportDialog run ownership', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('does not transfer ownership to a second start while the first run is active', async () => {
    const api = createMockApi()
    const completion = deferred<BatchResult>()
    api.batchImport.start.mockReturnValue(completion.promise)
    window.api = api

    const wrapper = mount(BatchImportDialog, {
      global: { plugins: [createPinia(), vuetify] }
    })
    const vm = wrapper.vm as unknown as BatchImportDialogVm
    vm.selectedFilePaths = ['/data/case.json']
    vm.fileCount = 1

    const firstStart = vm.confirmAndStartImport()
    const rejectedSecondStart = vm.confirmAndStartImport()
    await Promise.resolve()

    expect(api.batchImport.start).toHaveBeenCalledOnce()

    completion.resolve({
      succeeded: 1,
      failed: 0,
      skipped: 0,
      cancelled: false,
      details: []
    })
    await Promise.all([firstStart, rejectedSecondStart])
    wrapper.unmount()
  })
})
