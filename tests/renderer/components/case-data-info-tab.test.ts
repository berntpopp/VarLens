/**
 * Tests for CaseDataInfoTab.vue's loader, save(), and deleteExternalId().
 *
 * `wrapHandler` in the main process *resolves* an `IpcResult<T>` on failure
 * (it never rejects), so a raw `await api.caseMetadata.getDataInfo(...)`
 * returns a `SerializableError` object as if it were data. The loader must
 * pass every `caseMetadata.*` result through `unwrapIpcResult(...)` so a
 * failure throws into the surrounding try/catch instead of being stored as
 * `dataInfo`/`externalIds`/`platformSuggestions`/`idTypeSuggestions`.
 *
 * `save()` and `deleteExternalId()` have the same root cause in a different
 * shape ("discard-write"): they awaited a write call and discarded the
 * result, so a failure never threw into the surrounding catch.
 * `deleteExternalId()` was the worse of the two — it then optimistically
 * filtered the row out of `externalIds.value` regardless of whether the
 * backend delete actually succeeded, so a swallowed failure removed the row
 * from the UI while it still existed in the database.
 */

import { describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'

// The catch branch calls `logService.warn`, which lazily instantiates the
// pinia-backed log store (see LogService.ts `getStore()`). This component
// test mounts without a Pinia plugin, so stub the module — same pattern as
// tests/renderer/components/filters/ExtensionColumnFilters.test.ts.
vi.mock('../../../src/renderer/src/services/LogService', () => ({
  logService: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}))

import CaseDataInfoTab from '../../../src/renderer/src/components/CaseDataInfoTab.vue'
import { logService } from '../../../src/renderer/src/services/LogService'

const vuetify = createVuetify({ components, directives })

interface DataInfo {
  import_file_name: string | null
  import_file_type: string | null
  platform: string | null
  platform_details: string | null
  af_filter: string | null
  gene_list_filter: string | null
  region_filter: string | null
  quality_filter: string | null
  data_notes: string | null
  gene_list_id: number | null
  region_file_id: number | null
}

interface ExternalId {
  id_type: string
  id_value: string
}

interface CaseDataInfoTabVm {
  dataInfo: DataInfo | null
  externalIds: ExternalId[]
  platformSuggestions: string[]
  idTypeSuggestions: string[]
  save: () => Promise<void>
  deleteExternalId: (idType: string) => Promise<void>
}

// Runtime shape of a main-process SerializableError (src/shared/types/errors.ts).
// `isIpcError` discriminates on the presence of `code`/`message`/`userMessage`.
const fakeSerializableError = {
  code: 'DB_ERROR',
  message: 'boom',
  userMessage: 'boom'
}

const fakeDataInfo: DataInfo = {
  import_file_name: 'sample.vcf',
  import_file_type: 'vcf',
  platform: 'Exome',
  platform_details: 'Twist Exome v2',
  af_filter: '<0.01',
  gene_list_filter: null,
  region_filter: null,
  quality_filter: 'PASS',
  data_notes: 'test notes',
  gene_list_id: null,
  region_file_id: null
}

const fakeExternalIds: ExternalId[] = [{ id_type: 'MRN', id_value: '12345' }]

function installMockApi(
  getDataInfoResolvedValue: unknown,
  overrides: { upsertDataInfo?: unknown; deleteExternalId?: unknown } = {}
): { upsertDataInfo: ReturnType<typeof vi.fn>; deleteExternalId: ReturnType<typeof vi.fn> } {
  const upsertDataInfo = vi.fn().mockResolvedValue(overrides.upsertDataInfo ?? undefined)
  const deleteExternalId = vi.fn().mockResolvedValue(overrides.deleteExternalId ?? undefined)
  ;(window as unknown as Record<string, unknown>).api = {
    caseMetadata: {
      getDataInfo: vi.fn().mockResolvedValue(getDataInfoResolvedValue),
      listExternalIds: vi.fn().mockResolvedValue(fakeExternalIds),
      distinctPlatforms: vi.fn().mockResolvedValue(['CustomPlatformXYZ']),
      distinctExternalIdTypes: vi.fn().mockResolvedValue(['MRN']),
      upsertDataInfo,
      upsertExternalId: vi.fn().mockResolvedValue(undefined),
      deleteExternalId
    },
    geneLists: {
      list: vi.fn().mockResolvedValue([])
    },
    regionFiles: {
      list: vi.fn().mockResolvedValue([])
    }
  }
  return { upsertDataInfo, deleteExternalId }
}

function mountTab(): ReturnType<typeof mount> {
  return mount(CaseDataInfoTab, {
    global: { plugins: [vuetify] },
    props: { caseId: 1 }
  })
}

describe('CaseDataInfoTab loader', () => {
  it('does not store a SerializableError as dataInfo when caseMetadata.getDataInfo fails', async () => {
    installMockApi(fakeSerializableError)

    const wrapper = mountTab()
    await flushPromises()

    const vm = wrapper.vm as unknown as CaseDataInfoTabVm

    // Must be null (the initial default), never the raw SerializableError.
    expect(vm.dataInfo).toBeNull()
    // The sibling assignments must not have run with stale/raw data either —
    // the throw from unwrapIpcResult(info) aborts the rest of the try block.
    expect(vm.externalIds).toEqual([])
    expect(vm.platformSuggestions).toEqual(['Exome', 'Genome', 'Targeted Panel'])
    expect(vm.idTypeSuggestions).toEqual([])
  })

  it('populates real data when all caseMetadata calls succeed', async () => {
    installMockApi(fakeDataInfo)

    const wrapper = mountTab()
    await flushPromises()

    const vm = wrapper.vm as unknown as CaseDataInfoTabVm

    expect(vm.dataInfo).toEqual(fakeDataInfo)
    expect(vm.externalIds).toEqual(fakeExternalIds)
    expect(vm.platformSuggestions).toEqual([
      'CustomPlatformXYZ',
      'Exome',
      'Genome',
      'Targeted Panel'
    ])
    expect(vm.idTypeSuggestions).toEqual(['MRN'])
  })
})

const fakeSerializableErrorWithMessage = {
  code: 'DB_ERROR',
  message: 'save failed',
  userMessage: 'Could not save data info'
}

describe('CaseDataInfoTab save()', () => {
  it('logs a warning when upsertDataInfo fails (discard-write regression guard)', async () => {
    const mocks = installMockApi(fakeDataInfo, { upsertDataInfo: fakeSerializableErrorWithMessage })

    const wrapper = mountTab()
    await flushPromises()
    vi.mocked(logService.warn).mockClear()

    const vm = wrapper.vm as unknown as CaseDataInfoTabVm
    await vm.save()

    expect(mocks.upsertDataInfo).toHaveBeenCalled()
    // Before the fix, a raw (un-unwrapped) await never threw, so this catch
    // branch never ran and no warning was logged for a failed save.
    expect(logService.warn).toHaveBeenCalledWith(
      expect.stringContaining('Could not save data info'),
      'case-data-info'
    )
  })

  it('does not log a warning when upsertDataInfo succeeds', async () => {
    installMockApi(fakeDataInfo)

    const wrapper = mountTab()
    await flushPromises()
    vi.mocked(logService.warn).mockClear()

    const vm = wrapper.vm as unknown as CaseDataInfoTabVm
    await vm.save()

    expect(logService.warn).not.toHaveBeenCalled()
  })
})

describe('CaseDataInfoTab deleteExternalId()', () => {
  it('removes the row on success', async () => {
    installMockApi(fakeDataInfo)

    const wrapper = mountTab()
    await flushPromises()

    const vm = wrapper.vm as unknown as CaseDataInfoTabVm
    expect(vm.externalIds).toEqual(fakeExternalIds)

    await vm.deleteExternalId('MRN')

    expect(vm.externalIds).toEqual([])
  })

  it('does NOT remove the row and surfaces the error when deleteExternalId fails', async () => {
    installMockApi(fakeDataInfo, { deleteExternalId: fakeSerializableError })

    const wrapper = mountTab()
    await flushPromises()
    vi.mocked(logService.warn).mockClear()

    const vm = wrapper.vm as unknown as CaseDataInfoTabVm
    await vm.deleteExternalId('MRN')

    // Before the fix, a raw (un-unwrapped) await never threw, so the
    // optimistic filter ran unconditionally and removed the row even though
    // the backend delete failed.
    expect(vm.externalIds).toEqual(fakeExternalIds)
    expect(logService.warn).toHaveBeenCalledWith(expect.stringContaining('boom'), 'case-data-info')
  })
})
