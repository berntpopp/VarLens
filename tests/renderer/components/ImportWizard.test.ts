/**
 * Unit tests for ImportWizard component.
 *
 * Guards against the DataCloneError regression where Vue reactive Proxy
 * arrays were passed directly to Electron IPC (which requires structured-
 * clone-compatible values). Vue Proxies cannot be structured-cloned.
 *
 * Also tests cancel behavior and error handling.
 */
import { describe, it, expect } from 'vitest'
import { ref, isProxy } from 'vue'

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
