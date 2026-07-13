/**
 * Regression test for VcfImportDialog's `browseFiles` error surfacing.
 *
 * `browseFiles()` unwraps `api.import.selectFiles()` via `unwrapIpcResult`,
 * which throws the raw `SerializableError` object (a plain object, NOT an
 * `Error` instance — see `src/shared/types/errors.ts`) on a backend fault.
 * The file-local `handleError` helper used to do
 * `err instanceof Error ? err.message : String(err)`, so a thrown
 * `SerializableError` fell into `String(err)` and produced the literal
 * string `"[object Object]"` in the top-level error banner — exactly the
 * cryptic-error class this dialog's IPC-result unwrapping was meant to fix.
 *
 * The fix makes `handleError` extract `userMessage`/`message` for anything
 * matching the `SerializableError` shape (via the shared `isIpcError` /
 * `formatErrorMessage` helper), consistent with sibling call sites already
 * touched in the same PR (e.g. `ImportWizard.vue`, `PostgresConnectionDialog.vue`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'

import VcfImportDialog from '../../../../src/renderer/src/components/import/VcfImportDialog.vue'
import { AppStateKey, createAppState } from '../../../../src/renderer/src/composables/useAppState'
import { createMockApi, type MockApi } from '../../../utils/mock-api'
import { logService } from '../../../../src/renderer/src/services/LogService'

vi.mock('../../../../src/renderer/src/services/LogService', () => ({
  logService: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    critical: vi.fn()
  }
}))

const vuetify = createVuetify({ components, directives })

// Runtime shape of a main-process SerializableError (src/shared/types/errors.ts).
// Deliberately a PLAIN OBJECT (not `new Error(...)`) — that is what actually
// crosses the IPC boundary and what `unwrapIpcResult` throws.
const fakeSerializableError = {
  code: 'BACKEND',
  message: 'boom',
  userMessage: 'Could not open file dialog'
}

describe('VcfImportDialog — browseFiles error surfacing', () => {
  let wrapper: VueWrapper<InstanceType<typeof VcfImportDialog>>
  let mockApi: MockApi

  beforeEach(() => {
    setActivePinia(createPinia())
    mockApi = createMockApi()
    // `selectFiles` isn't in the MockApi factory's `import` stub yet — patch
    // it directly onto the mock for this test's purposes.
    ;(mockApi.import as unknown as { selectFiles: ReturnType<typeof vi.fn> }).selectFiles = vi.fn()
    window.api = mockApi as unknown as typeof window.api
    vi.clearAllMocks()
  })

  afterEach(() => {
    wrapper?.unmount()
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  function mountDialog() {
    wrapper = mount(VcfImportDialog, {
      props: { open: true },
      global: {
        plugins: [vuetify],
        provide: {
          [AppStateKey as symbol]: createAppState()
        }
      },
      attachTo: document.body
    })
    return wrapper
  }

  function clickBrowseFiles(): void {
    const button = Array.from(document.body.querySelectorAll('button')).find((btn) =>
      btn.textContent?.includes('Browse files')
    )
    expect(button).toBeInstanceOf(HTMLButtonElement)
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  }

  it('surfaces the SerializableError userMessage, not "[object Object]"', async () => {
    ;(
      mockApi.import as unknown as { selectFiles: ReturnType<typeof vi.fn> }
    ).selectFiles.mockResolvedValue(fakeSerializableError)

    mountDialog()
    await flushPromises()

    clickBrowseFiles()
    await flushPromises()

    expect(document.body.textContent).toContain('File selection failed: Could not open file dialog')
    expect(document.body.textContent).not.toContain('[object Object]')
    expect(logService.error).toHaveBeenCalledWith(
      expect.stringContaining('Could not open file dialog'),
      'VcfImportDialog'
    )
  })
})

/**
 * Regression test for VcfImportDialog's `startImport` error surfacing.
 *
 * `startImport()` has its own inline `catch` block (separate from the
 * shared `handleError` helper) that unwraps `api.import.startMultiFile()`
 * via `unwrapIpcResult`. On a backend fault this throws the raw
 * `SerializableError` object (a plain object, NOT an `Error` instance).
 * The pre-fix catch block stringified the caught value with
 * `err instanceof Error ? err.message : String(err)` in three places (the
 * log call, the per-file status entry, and the top-level `errorMessage`),
 * so a thrown `SerializableError` produced the literal string
 * `"[object Object]"` everywhere instead of `userMessage`.
 */
describe('VcfImportDialog — startImport error surfacing', () => {
  let wrapper: VueWrapper<InstanceType<typeof VcfImportDialog>>
  let mockApi: MockApi

  const previewFile = {
    fileformat: 'VCFv4.2',
    samples: ['sample1'],
    variantCountEstimate: 10,
    annotationType: 'none' as const,
    detectedGenomeBuild: null,
    infoFields: [],
    callerName: null,
    callerVersion: null,
    defaultVariantType: 'snv',
    filePath: '/tmp/test.vcf',
    fileSize: 1024
  }

  const previewResult = {
    files: [previewFile],
    siblingBedFiles: [],
    suggestedCaseName: 'test-case'
  }

  beforeEach(() => {
    setActivePinia(createPinia())
    mockApi = createMockApi()
    // `selectFiles`, `vcfMultiPreview`, and `startMultiFile` aren't in the
    // MockApi factory's `import` stub yet — patch them directly for this
    // test's purposes (mirrors the pattern used above for `selectFiles`).
    const importDomain = mockApi.import as unknown as {
      selectFiles: ReturnType<typeof vi.fn>
      vcfMultiPreview: ReturnType<typeof vi.fn>
      startMultiFile: ReturnType<typeof vi.fn>
    }
    importDomain.selectFiles = vi.fn().mockResolvedValue([previewFile.filePath])
    importDomain.vcfMultiPreview = vi.fn().mockResolvedValue(previewResult)
    importDomain.startMultiFile = vi.fn()
    window.api = mockApi as unknown as typeof window.api
    vi.clearAllMocks()
  })

  afterEach(() => {
    wrapper?.unmount()
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  function mountDialog() {
    wrapper = mount(VcfImportDialog, {
      props: { open: true },
      global: {
        plugins: [vuetify],
        provide: {
          [AppStateKey as symbol]: createAppState()
        }
      },
      attachTo: document.body
    })
    return wrapper
  }

  function clickButtonByText(text: string): void {
    const button = Array.from(document.body.querySelectorAll('button')).find((btn) =>
      btn.textContent?.includes(text)
    )
    expect(button).toBeInstanceOf(HTMLButtonElement)
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  }

  it('surfaces the SerializableError userMessage from startImport\'s catch, not "[object Object]"', async () => {
    ;(
      mockApi.import as unknown as { startMultiFile: ReturnType<typeof vi.fn> }
    ).startMultiFile.mockResolvedValue(fakeSerializableError)

    mountDialog()
    await flushPromises()

    // select -> review
    clickButtonByText('Browse files')
    await flushPromises()

    // review -> progress -> (rejected) back to review, with the error surfaced
    clickButtonByText('Import 1 file')
    await flushPromises()

    expect(document.body.textContent).toContain('Could not open file dialog')
    expect(document.body.textContent).not.toContain('[object Object]')
    expect(logService.error).toHaveBeenCalledWith(
      expect.stringContaining('Could not open file dialog'),
      'VcfImportDialog'
    )
  })
})
