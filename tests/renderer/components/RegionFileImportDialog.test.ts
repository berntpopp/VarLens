/**
 * Tests for RegionFileImportDialog's IpcResult unwrapping.
 *
 * `wrapHandler` in the main process resolves an `IpcResult<T>` even on
 * failure (it never rejects) — `region-files:create`/`importBed`/`list`
 * come back as a `SerializableError` shaped like `{ code, message,
 * userMessage }` when something goes wrong. Before this fix,
 * `importRegionFile()` awaited these raw and treated the result as data:
 * `created.id` would silently be `undefined` on failure, that `undefined`
 * would flow into `importBed`, and the (error) object would be emitted to
 * the parent as if it were the refreshed region-file list. This test
 * verifies the failure path now throws before any of that happens, and the
 * success path still wires the created id + refreshed list through
 * unchanged.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'

import RegionFileImportDialog from '../../../src/renderer/src/components/case-data-info/RegionFileImportDialog.vue'
import { createMockApi, type MockApi } from '../../utils/mock-api'
import { logService } from '../../../src/renderer/src/services/LogService'

vi.mock('../../../src/renderer/src/services/LogService', () => ({
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
// isIpcError discriminates on code/message/userMessage — there is no
// __isSerializableError marker field.
const fakeSerializableError = {
  code: 'DB_ERROR',
  message: 'UNIQUE constraint failed: region_files.name',
  userMessage: 'A region file with this name already exists'
}

describe('RegionFileImportDialog — importRegionFile IpcResult unwrapping', () => {
  let wrapper: VueWrapper<InstanceType<typeof RegionFileImportDialog>>
  let mockApi: MockApi

  beforeEach(() => {
    mockApi = createMockApi()
    mockApi.import.selectBedFile = vi.fn().mockResolvedValue('/tmp/regions.bed')
    window.api = mockApi as unknown as typeof window.api
    vi.clearAllMocks()
  })

  afterEach(() => {
    wrapper?.unmount()
    document.body.innerHTML = ''
  })

  function mountDialog() {
    wrapper = mount(RegionFileImportDialog, {
      props: { modelValue: true },
      global: { plugins: [vuetify] },
      attachTo: document.body
    })
    return wrapper
  }

  async function fillNameAndBedFile(name = 'My Regions') {
    const nameInput = document.body.querySelector('input')
    expect(nameInput).toBeInstanceOf(HTMLInputElement)
    ;(nameInput as HTMLInputElement).value = name
    nameInput?.dispatchEvent(new Event('input', { bubbles: true }))
    await wrapper.vm.$nextTick()

    const selectBtn = Array.from(document.body.querySelectorAll('button')).find((btn) =>
      btn.textContent?.includes('Select BED file')
    )
    expect(selectBtn).toBeInstanceOf(HTMLButtonElement)
    selectBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushPromises()
  }

  function clickImport() {
    const importBtn = Array.from(document.body.querySelectorAll('button')).find(
      (btn) => btn.textContent?.trim() === 'Import'
    )
    expect(importBtn).toBeInstanceOf(HTMLButtonElement)
    importBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  }

  it('creates, imports, and refreshes the list on success, then closes the dialog', async () => {
    const createdFile = {
      id: 7,
      name: 'My Regions',
      description: null,
      region_count: 0,
      total_bases: 0,
      created_at: 1_700_000_000_000,
      updated_at: 1_700_000_000_000
    }
    const refreshedList = [{ id: 7, name: 'My Regions', region_count: 12, total_bases: 4000 }]
    mockApi.regionFiles.create.mockResolvedValue(createdFile)
    mockApi.regionFiles.importBed.mockResolvedValue({ success: true })
    mockApi.regionFiles.list.mockResolvedValue(refreshedList)

    mountDialog()
    await fillNameAndBedFile()
    clickImport()
    await flushPromises()

    expect(mockApi.regionFiles.create).toHaveBeenCalledWith('My Regions', null)
    expect(mockApi.regionFiles.importBed).toHaveBeenCalledWith(7, '/tmp/regions.bed')
    expect(mockApi.regionFiles.list).toHaveBeenCalled()
    expect(wrapper.emitted('imported')).toEqual([[{ regionFileId: 7, regionFiles: refreshedList }]])
    expect(wrapper.emitted('update:modelValue')).toEqual([[false]])
    expect(logService.error).not.toHaveBeenCalled()
  })

  it('surfaces the error and does not apply a path when selectBedFile fails', async () => {
    // `import:selectBedFile` is wrapHandler-backed, so a failure resolves a
    // SerializableError rather than rejecting. Before the fix, the raw
    // (un-unwrapped) result only failed the `typeof result === 'string'`
    // guard silently — no warning was ever logged, so the user saw nothing
    // happen with no explanation.
    mockApi.import.selectBedFile = vi.fn().mockResolvedValue(fakeSerializableError)

    mountDialog()
    await fillNameAndBedFile()

    expect(document.body.textContent).not.toContain('regions.bed')
    expect(logService.warn).toHaveBeenCalledWith(
      expect.stringContaining('A region file with this name already exists'),
      'region-import'
    )
  })

  it('does not import the BED file or emit success when create fails', async () => {
    mockApi.regionFiles.create.mockResolvedValue(fakeSerializableError)

    mountDialog()
    await fillNameAndBedFile()
    clickImport()
    await flushPromises()

    // Must not proceed with an undefined/garbage id from the error object.
    expect(mockApi.regionFiles.importBed).not.toHaveBeenCalled()
    expect(mockApi.regionFiles.list).not.toHaveBeenCalled()
    expect(wrapper.emitted('imported')).toBeUndefined()
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()

    expect(logService.error).toHaveBeenCalledWith(
      expect.stringContaining('A region file with this name already exists'),
      'region-import'
    )
  })

  it('surfaces the real error and does not corrupt the emitted payload when the list refresh fails', async () => {
    const createdFile = {
      id: 9,
      name: 'My Regions',
      description: null,
      region_count: 0,
      total_bases: 0,
      created_at: 1_700_000_000_000,
      updated_at: 1_700_000_000_000
    }
    mockApi.regionFiles.create.mockResolvedValue(createdFile)
    mockApi.regionFiles.importBed.mockResolvedValue({ success: true })
    mockApi.regionFiles.list.mockResolvedValue(fakeSerializableError)

    mountDialog()
    await fillNameAndBedFile()
    clickImport()
    await flushPromises()

    // The error object must never be forwarded to the parent as if it were
    // the refreshed region-file list.
    expect(wrapper.emitted('imported')).toBeUndefined()
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    expect(logService.error).toHaveBeenCalledWith(
      expect.stringContaining('A region file with this name already exists'),
      'region-import'
    )
  })
})
