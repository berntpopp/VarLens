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
    ).selectFiles.mockRejectedValue(fakeSerializableError)

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
