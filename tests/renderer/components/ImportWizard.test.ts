/**
 * Unit tests for ImportWizard component.
 *
 * Guards against the DataCloneError regression where Vue reactive Proxy
 * arrays were passed directly to Electron IPC (which requires structured-
 * clone-compatible values). Vue Proxies cannot be structured-cloned.
 *
 * Also tests cancel behavior and error handling.
 */
import { afterEach, describe, it, expect, vi } from 'vitest'
import { ref, isProxy } from 'vue'
import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import ImportWizard from '../../../src/renderer/src/components/import/ImportWizard.vue'
import { useImportStatusStore } from '../../../src/renderer/src/stores/importStatusStore'
import { createMockApi } from '../../utils/mock-api'
import type { BatchResult } from '../../../src/shared/types/api'

vi.mock('../../../src/renderer/src/services/LogService', () => ({
  logService: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}))

const vuetify = createVuetify({ components, directives })

interface ImportWizardVm {
  step: number
  cancelError: string
  summary: BatchResult
  isVcfImport: boolean
  vcfFilePath: string
  vcfSelectedSamples: string[]
  vcfCaseNames: Map<string, string>
  startVcfImport: () => Promise<void>
  startImport: () => Promise<void>
  cancelImport: () => Promise<void>
  show: () => void
}

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

/**
 * Simulates Electron's structured clone validation.
 * Throws DataCloneError for Proxy objects, just like ipcRenderer.invoke.
 */
function assertStructuredCloneable(value: unknown, path = 'root'): void {
  if (value === null || value === undefined) return
  if (typeof value !== 'object') return // primitives are always cloneable

  if (isProxy(value)) {
    throw new DOMException(
      `Value at "${path}" is a Vue Proxy and cannot be structured-cloned. ` +
        'Use [...array] or { ...obj } to create a plain copy before passing to IPC.',
      'DataCloneError'
    )
  }

  if (Array.isArray(value)) {
    value.forEach((item, i) => assertStructuredCloneable(item, `${path}[${i}]`))
    return
  }

  for (const [key, val] of Object.entries(value)) {
    assertStructuredCloneable(val, `${path}.${key}`)
  }
}

describe('ImportWizard IPC safety', () => {
  afterEach(() => {
    window.__VARLENS_WEB__ = false
  })

  describe('Vue reactive Proxy detection', () => {
    it('should detect that ref<string[]>.value is a Proxy', () => {
      const paths = ref(['file1.json', 'file2.json'])
      // Vue 3 ref wraps arrays in a Proxy
      expect(isProxy(paths.value)).toBe(true)
    })

    it('should detect that ref<object[]>.value items are proxied', () => {
      const items = ref([{ name: 'a' }, { name: 'b' }])
      expect(isProxy(items.value)).toBe(true)
    })

    it('should NOT detect primitives as Proxy', () => {
      const str = ref('hello')
      expect(isProxy(str.value)).toBe(false)

      const num = ref(42)
      expect(isProxy(num.value)).toBe(false)
    })
  })

  describe('assertStructuredCloneable', () => {
    it('should accept plain arrays', () => {
      expect(() => assertStructuredCloneable(['a', 'b', 'c'])).not.toThrow()
    })

    it('should accept plain objects', () => {
      expect(() =>
        assertStructuredCloneable({ succeeded: 3, details: [{ name: 'a' }] })
      ).not.toThrow()
    })

    it('should reject Vue Proxy arrays', () => {
      const proxyArray = ref(['a', 'b'])
      expect(() => assertStructuredCloneable(proxyArray.value)).toThrow('Vue Proxy')
    })

    it('should accept spread copy of Proxy array', () => {
      const proxyArray = ref(['a', 'b'])
      expect(() => assertStructuredCloneable([...proxyArray.value])).not.toThrow()
    })
  })

  describe('IPC argument preparation', () => {
    it('should produce cloneable arguments for batchImport.start', () => {
      // Simulate the ImportWizard's state
      const selectedFilePaths = ref(['/path/to/file1.json', '/path/to/file2.json'])
      const duplicateStrategy = ref<'skip' | 'overwrite'>('skip')
      const stripText = ref('')

      // This is how the FIXED code prepares arguments
      const args = [
        [...selectedFilePaths.value], // spread to plain array
        duplicateStrategy.value,
        stripText.value || undefined
      ]

      // All args must be structured-clone-compatible
      for (const [i, arg] of args.entries()) {
        expect(() => assertStructuredCloneable(arg, `arg[${i}]`)).not.toThrow()
      }
    })

    it('should FAIL if Proxy array is passed directly (the regression)', () => {
      const selectedFilePaths = ref(['/path/to/file1.json', '/path/to/file2.json'])

      // This is how the BROKEN code passed arguments
      expect(() =>
        assertStructuredCloneable(selectedFilePaths.value, 'selectedFilePaths.value')
      ).toThrow('Vue Proxy')
    })

    it('should produce cloneable arguments for setGenes', () => {
      // Simulate the PanelEditorDialog's computed
      const approvedGenes = ref([
        { hgncId: 'HGNC:1', symbol: 'BRCA1' },
        { hgncId: 'HGNC:2', symbol: 'TP53' }
      ])

      // Fixed: spread + map to plain objects
      const plainGenes = [...approvedGenes.value].map((g) => ({ ...g }))

      expect(() => assertStructuredCloneable(plainGenes)).not.toThrow()
    })
  })

  describe('cancel behavior', () => {
    it('should produce a valid cancelled summary', () => {
      // Simulate what cancelImport() now creates
      const summary = {
        succeeded: 0,
        failed: 0,
        skipped: 0,
        cancelled: true,
        details: []
      }

      expect(summary.cancelled).toBe(true)
      expect(summary.details).toEqual([])
      expect(() => assertStructuredCloneable(summary)).not.toThrow()
    })

    it('keeps the import active after cancel fails and accepts the real completion', async () => {
      const mockApi = createMockApi()
      const cancelError = {
        code: 'CANCEL_FAILED',
        message: 'worker did not acknowledge cancellation',
        userMessage: 'Could not cancel the import'
      }
      const pendingStart = deferred<BatchResult>()
      let completeImport: ((result: BatchResult) => void) | undefined
      mockApi.batchImport.start.mockReturnValue(pendingStart.promise)
      mockApi.batchImport.cancel.mockResolvedValue(cancelError)
      mockApi.batchImport.onComplete.mockImplementation((callback) => {
        completeImport = callback
        return vi.fn()
      })
      window.api = mockApi

      const pinia = createPinia()
      const wrapper = mount(ImportWizard, { global: { plugins: [pinia, vuetify] } })
      const store = useImportStatusStore(pinia)
      const vm = wrapper.vm as unknown as ImportWizardVm
      const importRun = vm.startImport()
      await Promise.resolve()

      await vm.cancelImport()

      expect(vm.step).toBe(3)
      expect(store.phase).toBe('importing')
      expect(vm.cancelError).toBe('Could not cancel the import')

      const realResult: BatchResult = {
        succeeded: 1,
        failed: 0,
        skipped: 0,
        cancelled: false,
        details: []
      }
      expect(completeImport).toBeDefined()
      completeImport!(realResult)
      pendingStart.resolve(realResult)
      await importRun

      expect(vm.step).toBe(4)
      expect(store.phase).toBe('complete')
      expect(vm.summary).toEqual(realResult)
      expect(vm.cancelError).toBe('')
      wrapper.unmount()
    })

    it('keeps the run active after cancellation acknowledgement until its terminal result', async () => {
      const mockApi = createMockApi()
      const pendingCancel = deferred<undefined>()
      const pendingStart = deferred<BatchResult>()
      let completeImport: ((result: BatchResult) => void) | undefined
      mockApi.batchImport.cancel.mockReturnValue(pendingCancel.promise)
      mockApi.batchImport.start.mockReturnValue(pendingStart.promise)
      mockApi.batchImport.onComplete.mockImplementation((callback) => {
        completeImport = callback
        return vi.fn()
      })
      window.api = mockApi

      const pinia = createPinia()
      const wrapper = mount(ImportWizard, { global: { plugins: [pinia, vuetify] } })
      const store = useImportStatusStore(pinia)
      const vm = wrapper.vm as unknown as ImportWizardVm
      const importRun = vm.startImport()
      await Promise.resolve()

      const cancellation = vm.cancelImport()

      expect(vm.step).toBe(3)
      expect(store.phase).toBe('importing')

      pendingCancel.resolve(undefined)
      await cancellation

      expect(vm.step).toBe(3)
      expect(store.phase).toBe('importing')

      const cancelledResult: BatchResult = {
        succeeded: 0,
        failed: 0,
        skipped: 0,
        cancelled: true,
        details: []
      }
      completeImport!(cancelledResult)
      pendingStart.resolve(cancelledResult)
      await importRun

      expect(vm.step).toBe(4)
      expect(store.phase).toBe('cancelled')
      expect(vm.summary.cancelled).toBe(true)
      wrapper.unmount()
    })

    it('does not overwrite a real completion with a late cancel acknowledgement', async () => {
      const mockApi = createMockApi()
      const pendingCancel = deferred<undefined>()
      const pendingStart = deferred<BatchResult>()
      let completeImport: ((result: BatchResult) => void) | undefined
      mockApi.batchImport.cancel.mockReturnValue(pendingCancel.promise)
      mockApi.batchImport.start.mockReturnValue(pendingStart.promise)
      mockApi.batchImport.onComplete.mockImplementation((callback) => {
        completeImport = callback
        return vi.fn()
      })
      window.api = mockApi

      const pinia = createPinia()
      const wrapper = mount(ImportWizard, { global: { plugins: [pinia, vuetify] } })
      const store = useImportStatusStore(pinia)
      const vm = wrapper.vm as unknown as ImportWizardVm
      const importRun = vm.startImport()
      await Promise.resolve()

      const cancellation = vm.cancelImport()
      const realResult: BatchResult = {
        succeeded: 1,
        failed: 0,
        skipped: 0,
        cancelled: false,
        details: []
      }
      completeImport!(realResult)
      pendingCancel.resolve(undefined)
      await cancellation
      pendingStart.resolve(realResult)
      await importRun

      expect(vm.step).toBe(4)
      expect(store.phase).toBe('complete')
      expect(vm.summary).toEqual(realResult)
      wrapper.unmount()
    })

    it.each([
      { label: 'desktop', web: false },
      { label: 'web', web: true }
    ])('routes a $label VCF cancellation to the active import executor', async ({ web }) => {
      const mockApi = createMockApi()
      window.__VARLENS_WEB__ = web
      window.api = mockApi

      const pinia = createPinia()
      const wrapper = mount(ImportWizard, { global: { plugins: [pinia, vuetify] } })
      const store = useImportStatusStore(pinia)
      const vm = wrapper.vm as unknown as ImportWizardVm
      store.startImport(1)
      vm.isVcfImport = true
      vm.step = 3

      await vm.cancelImport()

      expect(mockApi.import.cancel).toHaveBeenCalledOnce()
      expect(mockApi.batchImport.cancel).not.toHaveBeenCalled()
      expect(store.phase).toBe('importing')
      wrapper.unmount()
    })

    it('keeps acknowledged VCF cancellation terminal when the active start call settles later', async () => {
      const mockApi = createMockApi()
      const pendingStart = deferred<{ variantCount: number }>()
      mockApi.import.start.mockReturnValue(pendingStart.promise)
      window.api = mockApi

      const pinia = createPinia()
      const wrapper = mount(ImportWizard, { global: { plugins: [pinia, vuetify] } })
      const store = useImportStatusStore(pinia)
      const vm = wrapper.vm as unknown as ImportWizardVm
      vm.isVcfImport = true
      vm.vcfFilePath = '/case.vcf'
      vm.vcfSelectedSamples = ['S1']
      vm.vcfCaseNames = new Map([['S1', 'Case 1']])

      const importRun = vm.startVcfImport()
      await Promise.resolve()
      expect(store.phase).toBe('importing')

      await vm.cancelImport()
      expect(store.phase).toBe('importing')
      expect(vm.step).toBe(3)

      pendingStart.resolve({ variantCount: 12 })
      await importRun

      expect(store.phase).toBe('cancelled')
      expect(vm.summary.cancelled).toBe(true)
      expect(vm.step).toBe(4)
      wrapper.unmount()
    })

    it('keeps acknowledged batch cancellation terminal when the active start call rejects later', async () => {
      const mockApi = createMockApi()
      const pendingStart = deferred<BatchResult>()
      mockApi.batchImport.start.mockReturnValue(pendingStart.promise)
      window.api = mockApi

      const pinia = createPinia()
      const wrapper = mount(ImportWizard, { global: { plugins: [pinia, vuetify] } })
      const store = useImportStatusStore(pinia)
      const vm = wrapper.vm as unknown as ImportWizardVm

      const importRun = vm.startImport()
      await Promise.resolve()
      expect(store.phase).toBe('importing')

      await vm.cancelImport()
      pendingStart.reject(new Error('worker stopped after cancellation'))
      await importRun

      expect(store.phase).toBe('cancelled')
      expect(vm.summary.cancelled).toBe(true)
      expect(vm.step).toBe(4)
      wrapper.unmount()
    })

    it('does not reset or start a new VCF run until the cancelled run settles', async () => {
      const mockApi = createMockApi()
      const oldStart = deferred<{ variantCount: number }>()
      mockApi.import.start.mockReturnValue(oldStart.promise)
      window.api = mockApi

      const pinia = createPinia()
      const wrapper = mount(ImportWizard, { global: { plugins: [pinia, vuetify] } })
      const store = useImportStatusStore(pinia)
      const vm = wrapper.vm as unknown as ImportWizardVm
      vm.isVcfImport = true
      vm.vcfFilePath = '/old.vcf'
      vm.vcfSelectedSamples = ['OLD']
      vm.vcfCaseNames = new Map([['OLD', 'Old case']])

      const oldRun = vm.startVcfImport()
      await Promise.resolve()
      await vm.cancelImport()

      vm.show()
      const blockedRun = vm.startVcfImport()
      await blockedRun

      expect(mockApi.import.start).toHaveBeenCalledOnce()
      expect(store.phase).toBe('importing')
      expect(vm.step).toBe(3)

      oldStart.resolve({ variantCount: 99 })
      await oldRun

      expect(store.phase).toBe('cancelled')
      expect(vm.step).toBe(4)
      expect(vm.summary.details).toEqual([])
      wrapper.unmount()
    })

    it('blocks a same-kind batch restart until the cancelled batch event settles', async () => {
      const mockApi = createMockApi()
      const oldBatchStart = deferred<BatchResult>()
      let completeBatch: ((result: BatchResult) => void) | undefined
      mockApi.batchImport.start.mockReturnValue(oldBatchStart.promise)
      mockApi.batchImport.onComplete.mockImplementation((callback) => {
        completeBatch = callback
        return vi.fn()
      })
      window.api = mockApi

      const pinia = createPinia()
      const wrapper = mount(ImportWizard, { global: { plugins: [pinia, vuetify] } })
      const store = useImportStatusStore(pinia)
      const vm = wrapper.vm as unknown as ImportWizardVm

      const oldRun = vm.startImport()
      await Promise.resolve()
      await vm.cancelImport()

      vm.show()
      await vm.startImport()

      expect(mockApi.batchImport.start).toHaveBeenCalledOnce()
      expect(store.phase).toBe('importing')
      expect(vm.step).toBe(3)

      const oldResult: BatchResult = {
        succeeded: 0,
        failed: 0,
        skipped: 0,
        cancelled: true,
        details: []
      }
      completeBatch!(oldResult)
      oldBatchStart.resolve(oldResult)
      await oldRun

      expect(store.phase).toBe('cancelled')
      expect(vm.step).toBe(4)
      expect(vm.summary.details).toEqual([])
      wrapper.unmount()
    })
  })

  describe('error handling', () => {
    it('should handle SerializableError responses gracefully', () => {
      // Simulate what wrapHandler returns on error
      const errorResponse = {
        code: 'UNKNOWN',
        message: 'Something went wrong',
        userMessage: 'An unexpected error occurred.'
      }

      // The guard check in startImport
      const isValid =
        errorResponse && Array.isArray((errorResponse as { details?: unknown }).details)
      expect(isValid).toBe(false)

      // Error message extraction
      const errorMsg =
        'userMessage' in errorResponse ? errorResponse.userMessage : 'Import failed unexpectedly'
      expect(errorMsg).toBe('An unexpected error occurred.')
    })
  })
})
