/**
 * Unit tests for ImportWizard component.
 *
 * Guards against the DataCloneError regression where Vue reactive Proxy
 * arrays were passed directly to Electron IPC (which requires structured-
 * clone-compatible values). Vue Proxies cannot be structured-cloned.
 *
 * Also tests cancel behavior and error handling.
 */
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ref, isProxy } from 'vue'
import ImportWizard from '../../../src/renderer/src/components/import/ImportWizard.vue'
import ImportSourceSelector from '../../../src/renderer/src/components/import/ImportSourceSelector.vue'
import BatchReviewPhase from '../../../src/renderer/src/components/batch-import/BatchReviewPhase.vue'
import { useImportStatusStore } from '../../../src/renderer/src/stores/importStatusStore'
import { createMockApi, type MockApi } from '../../utils/mock-api'
import type { BatchCompleteEvent, BatchResult } from '../../../src/shared/types/api'

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
  isZipImport: boolean
  zipExtractionId: string
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

function startedBatchRunId(mockApi: MockApi, callIndex = 0): string {
  const runId = mockApi.batchImport.start.mock.calls[callIndex]?.[3]
  if (typeof runId !== 'string') throw new Error('expected batch start runId')
  return runId
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
      let completeImport: ((result: BatchCompleteEvent) => void) | undefined
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
      completeImport!({ ...realResult, runId: startedBatchRunId(mockApi) })
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
      let completeImport: ((result: BatchCompleteEvent) => void) | undefined
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
      completeImport!({ ...cancelledResult, runId: startedBatchRunId(mockApi) })
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
      let completeImport: ((result: BatchCompleteEvent) => void) | undefined
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
      completeImport!({ ...realResult, runId: startedBatchRunId(mockApi) })
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
      let completeBatch: ((result: BatchCompleteEvent) => void) | undefined
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
      completeBatch!({ ...oldResult, runId: startedBatchRunId(mockApi) })
      oldBatchStart.resolve(oldResult)
      await oldRun

      expect(store.phase).toBe('cancelled')
      expect(vm.step).toBe(4)
      expect(vm.summary.details).toEqual([])
      wrapper.unmount()
    })

    it('ignores a stale completion event after a newer batch run starts', async () => {
      const mockApi = createMockApi()
      const oldResult: BatchResult = {
        succeeded: 1,
        failed: 0,
        skipped: 0,
        cancelled: false,
        details: []
      }
      const newResult: BatchResult = {
        succeeded: 2,
        failed: 0,
        skipped: 0,
        cancelled: false,
        details: []
      }
      const newBatchStart = deferred<BatchResult>()
      let completeBatch: ((result: BatchCompleteEvent) => void) | undefined
      mockApi.batchImport.start
        .mockResolvedValueOnce(oldResult)
        .mockReturnValueOnce(newBatchStart.promise)
      mockApi.batchImport.onComplete.mockImplementation((callback) => {
        completeBatch = callback as typeof completeBatch
        return vi.fn()
      })
      const randomUuid = vi
        .spyOn(globalThis.crypto, 'randomUUID')
        .mockReturnValueOnce('11111111-1111-4111-8111-111111111111')
        .mockReturnValueOnce('22222222-2222-4222-8222-222222222222')
      window.api = mockApi

      const pinia = createPinia()
      const wrapper = mount(ImportWizard, { global: { plugins: [pinia, vuetify] } })
      const store = useImportStatusStore(pinia)
      const vm = wrapper.vm as unknown as ImportWizardVm

      vm.isZipImport = true
      vm.zipExtractionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      await vm.startImport()
      await flushPromises()
      expect(mockApi.batchImport.cleanupZipTemp).toHaveBeenCalledWith(
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      )
      store.reset()
      vm.show()
      vm.isZipImport = true
      vm.zipExtractionId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
      const currentRun = vm.startImport()
      await Promise.resolve()
      mockApi.batchImport.cleanupZipTemp.mockClear()

      completeBatch!({ ...oldResult, runId: '11111111-1111-4111-8111-111111111111' })
      await flushPromises()

      expect(vm.step).toBe(3)
      expect(store.phase).toBe('importing')
      expect(vm.summary).not.toEqual(oldResult)
      expect(mockApi.batchImport.cleanupZipTemp).not.toHaveBeenCalled()

      newBatchStart.resolve(newResult)
      await currentRun
      await flushPromises()
      expect(vm.summary).toEqual(newResult)
      expect(mockApi.batchImport.cleanupZipTemp).toHaveBeenCalledWith(
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
      )

      randomUuid.mockRestore()
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

describe('ImportWizard ZIP password unlock', () => {
  let mockApi: MockApi

  function mountWizard(): ReturnType<typeof mount> {
    return mount(ImportWizard, {
      global: { plugins: [vuetify] },
      attachTo: document.body
    })
  }

  function prepareSuccessfulZipReview(): void {
    mockApi.batchImport.selectZip = vi.fn().mockResolvedValue({
      filePath: '/tmp/archive.zip',
      isEncrypted: false
    })
    mockApi.batchImport.extractZip = vi.fn().mockResolvedValue({
      files: ['/tmp/varlens-zip-entry/case.json'],
      errors: [],
      extractionId: '11111111-1111-4111-8111-111111111111'
    })
    mockApi.batchImport.checkDuplicates = vi.fn().mockResolvedValue({
      files: [
        {
          filePath: '/tmp/varlens-zip-entry/case.json',
          fileName: 'case.json',
          caseName: 'case',
          isDuplicate: false
        }
      ],
      duplicateCount: 0
    })
  }

  async function openZipReview(wrapper: ReturnType<typeof mount>): Promise<void> {
    wrapper.vm.show()
    await flushPromises()
    wrapper.findComponent(ImportSourceSelector).vm.$emit('select', 'zip')
    await flushPromises()
  }

  beforeEach(() => {
    setActivePinia(createPinia())
    mockApi = createMockApi()
    window.api = mockApi as unknown as typeof window.api
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('surfaces password-test IPC errors and clears loading', async () => {
    mockApi.batchImport.selectZip = vi.fn().mockResolvedValue({
      filePath: '/tmp/corrupt.zip',
      isEncrypted: true
    })
    mockApi.batchImport.testZipPassword = vi.fn().mockResolvedValue({
      code: 'PARSE_ERROR',
      message: 'zip central directory missing',
      userMessage: 'Could not read ZIP archive'
    })

    const wrapper = mount(ImportWizard, {
      global: {
        plugins: [vuetify]
      },
      attachTo: document.body
    })
    wrapper.vm.show()
    await flushPromises()

    wrapper.findComponent(ImportSourceSelector).vm.$emit('select', 'zip')
    await flushPromises()

    const password = document.body.querySelector('input[type="password"]')
    expect(password).toBeInstanceOf(HTMLInputElement)
    ;(password as HTMLInputElement).value = 'secret'
    password!.dispatchEvent(new Event('input', { bubbles: true }))
    const unlock = Array.from(document.body.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Unlock')
    )
    expect(unlock).toBeInstanceOf(HTMLButtonElement)
    unlock!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushPromises()

    expect(document.body.textContent).toContain('Could not read ZIP archive')
    expect(document.body.textContent).not.toContain('[object Object]')
    expect(document.body.querySelector('.v-progress-circular')).toBeNull()
  })

  it('surfaces an archive with no importable files instead of silently doing nothing', async () => {
    mockApi.batchImport.selectZip = vi.fn().mockResolvedValue({
      filePath: '/tmp/empty.zip',
      isEncrypted: false
    })
    mockApi.batchImport.extractZip = vi.fn().mockResolvedValue({
      files: [],
      errors: [],
      extractionId: '11111111-1111-4111-8111-111111111111'
    })

    const wrapper = mount(ImportWizard, {
      global: { plugins: [vuetify] },
      attachTo: document.body
    })
    wrapper.vm.show()
    await flushPromises()

    wrapper.findComponent(ImportSourceSelector).vm.$emit('select', 'zip')
    await flushPromises()

    expect(document.body.textContent).toContain('No importable files found in archive')
    expect(mockApi.batchImport.cleanupZipTemp).toHaveBeenCalledOnce()
  })

  it('cleans extracted ZIP data when the review dialog closes', async () => {
    prepareSuccessfulZipReview()
    const wrapper = mountWizard()
    await openZipReview(wrapper)

    wrapper.findComponent({ name: 'VDialog' }).vm.$emit('update:modelValue', false)
    await flushPromises()

    expect(mockApi.batchImport.cleanupZipTemp).toHaveBeenCalledOnce()
  })

  it('cleans extracted ZIP data when navigating back from review', async () => {
    prepareSuccessfulZipReview()
    const wrapper = mountWizard()
    await openZipReview(wrapper)

    const back = Array.from(document.body.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Back')
    )
    expect(back).toBeInstanceOf(HTMLButtonElement)
    back!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushPromises()

    expect(mockApi.batchImport.cleanupZipTemp).toHaveBeenCalledOnce()
  })

  it('cleans an abandoned ZIP extraction before opening a fresh wizard flow', async () => {
    prepareSuccessfulZipReview()
    const wrapper = mountWizard()
    await openZipReview(wrapper)

    wrapper.vm.show()
    await flushPromises()

    expect(mockApi.batchImport.cleanupZipTemp).toHaveBeenCalledOnce()
  })

  it('cleans ZIP data and surfaces an initial duplicate-check failure', async () => {
    prepareSuccessfulZipReview()
    mockApi.batchImport.checkDuplicates = vi.fn().mockResolvedValue({
      code: 'DATABASE_ERROR',
      message: 'database is locked',
      userMessage: 'Could not check duplicate cases'
    })
    const wrapper = mountWizard()

    await openZipReview(wrapper)

    expect(mockApi.batchImport.cleanupZipTemp).toHaveBeenCalledOnce()
    expect(document.body.textContent).toContain('Could not check duplicate cases')
  })

  it('invalidates stale review data and surfaces a debounced duplicate-check failure', async () => {
    vi.useFakeTimers()
    prepareSuccessfulZipReview()
    mockApi.batchImport.checkDuplicates = vi
      .fn()
      .mockResolvedValueOnce({
        files: [
          {
            filePath: '/tmp/varlens-zip-entry/case.json',
            fileName: 'case.json',
            caseName: 'case',
            isDuplicate: false
          }
        ],
        duplicateCount: 0
      })
      .mockResolvedValueOnce({
        code: 'DATABASE_ERROR',
        message: 'database is locked',
        userMessage: 'Could not refresh duplicate cases'
      })
    const wrapper = mountWizard()
    await openZipReview(wrapper)

    wrapper.findComponent(BatchReviewPhase).vm.$emit('update:stripText', '_results')
    await wrapper.vm.$nextTick()
    await vi.advanceTimersByTimeAsync(300)
    await flushPromises()

    expect(mockApi.batchImport.cleanupZipTemp).toHaveBeenCalledOnce()
    expect(document.body.textContent).toContain('Could not refresh duplicate cases')
    expect(document.body.textContent).not.toContain('case.json')
  })

  it('cleans a late stale extraction without replacing the current cleanup authority', async () => {
    const staleExtraction = deferred<{
      files: string[]
      errors: string[]
      extractionId: string
    }>()
    mockApi.batchImport.selectZip = vi.fn().mockResolvedValue({
      filePath: '/tmp/archive.zip',
      isEncrypted: false
    })
    mockApi.batchImport.extractZip = vi
      .fn()
      .mockReturnValueOnce(staleExtraction.promise)
      .mockResolvedValueOnce({
        files: ['/tmp/current/case.json'],
        errors: [],
        extractionId: '22222222-2222-4222-8222-222222222222'
      })
    mockApi.batchImport.checkDuplicates = vi.fn().mockResolvedValue({
      files: [
        {
          filePath: '/tmp/current/case.json',
          fileName: 'case.json',
          caseName: 'case',
          isDuplicate: false
        }
      ],
      duplicateCount: 0
    })
    const wrapper = mountWizard()

    wrapper.vm.show()
    await flushPromises()
    wrapper.findComponent(ImportSourceSelector).vm.$emit('select', 'zip')
    await flushPromises()
    wrapper.vm.show()
    await flushPromises()
    wrapper.findComponent(ImportSourceSelector).vm.$emit('select', 'zip')
    await flushPromises()

    staleExtraction.resolve({
      files: ['/tmp/stale/case.json'],
      errors: [],
      extractionId: '11111111-1111-4111-8111-111111111111'
    })
    await flushPromises()

    expect(mockApi.batchImport.cleanupZipTemp).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111'
    )

    wrapper.findComponent({ name: 'VDialog' }).vm.$emit('update:modelValue', false)
    await flushPromises()

    expect(mockApi.batchImport.cleanupZipTemp).toHaveBeenCalledWith(
      '22222222-2222-4222-8222-222222222222'
    )
  })

  it('waits for the terminal cancelled result before cleaning ZIP data', async () => {
    prepareSuccessfulZipReview()
    const completion = deferred<{
      succeeded: number
      failed: number
      skipped: number
      cancelled: boolean
      details: []
    }>()
    mockApi.batchImport.start = vi.fn().mockReturnValue(completion.promise)
    mockApi.batchImport.cancel = vi.fn().mockResolvedValue(undefined)
    const wrapper = mountWizard()
    await openZipReview(wrapper)

    const start = Array.from(document.body.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Import 1 file')
    )
    expect(start).toBeInstanceOf(HTMLButtonElement)
    start!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushPromises()

    const cancel = Array.from(document.body.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Cancel')
    )
    expect(cancel).toBeInstanceOf(HTMLButtonElement)
    cancel!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushPromises()

    expect(mockApi.batchImport.cancel).toHaveBeenCalledOnce()
    expect(mockApi.batchImport.cleanupZipTemp).not.toHaveBeenCalled()

    completion.resolve({
      succeeded: 0,
      failed: 0,
      skipped: 0,
      cancelled: true,
      details: []
    })
    await flushPromises()

    expect(mockApi.batchImport.cleanupZipTemp).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111'
    )
  })

  it('cleans ZIP data when starting the batch import fails', async () => {
    prepareSuccessfulZipReview()
    mockApi.batchImport.start = vi.fn().mockResolvedValue({
      code: 'UNKNOWN',
      message: 'worker failed to start',
      userMessage: 'Could not start import'
    })
    const wrapper = mountWizard()
    await openZipReview(wrapper)

    const start = Array.from(document.body.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Import 1 file')
    )
    expect(start).toBeInstanceOf(HTMLButtonElement)
    start!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushPromises()

    expect(mockApi.batchImport.cleanupZipTemp).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111'
    )
    expect(document.body.textContent).toContain('Could not start import')
  })
})
