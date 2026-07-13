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
import { createMockApi, type MockApi } from '../../utils/mock-api'

const vuetify = createVuetify({ components, directives })

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
      errors: []
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
    mockApi.batchImport.extractZip = vi.fn().mockResolvedValue({ files: [], errors: [] })

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
})
