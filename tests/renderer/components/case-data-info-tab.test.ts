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
  addExternalId: (idType: string, idValue: string) => Promise<void>
  deleteExternalId: (idType: string) => Promise<void>
  openGeneListEditor: () => void
  onGeneListSaved: (payload: {
    listId: number
    geneLists: Array<{ id: number; name: string; gene_count: number }>
  }) => Promise<void>
  onGeneListDeleted: (payload: {
    geneLists: Array<{ id: number; name: string; gene_count: number }>
  }) => Promise<void>
  openRegionFileImport: () => void
  onRegionFileImported: (payload: {
    regionFileId: number
    regionFiles: Array<{ id: number; name: string; region_count: number; total_bases: number }>
  }) => Promise<void>
}

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
} {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
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
  overrides: {
    upsertDataInfo?: unknown
    deleteExternalId?: unknown
    upsertExternalId?: unknown
  } = {}
): {
  upsertDataInfo: ReturnType<typeof vi.fn>
  deleteExternalId: ReturnType<typeof vi.fn>
  upsertExternalId: ReturnType<typeof vi.fn>
  listExternalIds: ReturnType<typeof vi.fn>
  distinctExternalIdTypes: ReturnType<typeof vi.fn>
} {
  const upsertDataInfo = vi.fn().mockResolvedValue(overrides.upsertDataInfo ?? undefined)
  const deleteExternalId = vi.fn().mockResolvedValue(overrides.deleteExternalId ?? undefined)
  const upsertExternalId = vi.fn().mockResolvedValue(overrides.upsertExternalId ?? undefined)
  const listExternalIds = vi.fn().mockResolvedValue(fakeExternalIds)
  const distinctExternalIdTypes = vi.fn().mockResolvedValue(['MRN'])
  ;(window as unknown as Record<string, unknown>).api = {
    caseMetadata: {
      getDataInfo: vi.fn().mockResolvedValue(getDataInfoResolvedValue),
      listExternalIds,
      distinctPlatforms: vi.fn().mockResolvedValue(['CustomPlatformXYZ']),
      distinctExternalIdTypes,
      upsertDataInfo,
      upsertExternalId,
      deleteExternalId
    },
    geneLists: {
      list: vi.fn().mockResolvedValue([])
    },
    regionFiles: {
      list: vi.fn().mockResolvedValue([])
    }
  }
  return {
    upsertDataInfo,
    deleteExternalId,
    upsertExternalId,
    listExternalIds,
    distinctExternalIdTypes
  }
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

  it('clears the previous case atomically and blocks save when a later loader fails', async () => {
    const mocks = installMockApi(fakeDataInfo)
    const wrapper = mountTab()
    await flushPromises()

    window.api.regionFiles.list = vi.fn().mockResolvedValue(fakeSerializableError)
    await wrapper.setProps({ caseId: 2 })
    await flushPromises()

    const vm = wrapper.vm as unknown as CaseDataInfoTabVm
    expect(vm.dataInfo).toBeNull()
    expect(vm.externalIds).toEqual([])
    expect(vm.platformSuggestions).toEqual(['Exome', 'Genome', 'Targeted Panel'])
    expect(vm.idTypeSuggestions).toEqual([])

    await vm.save()
    expect(mocks.upsertDataInfo).not.toHaveBeenCalled()
  })

  it('ignores an older load that completes after the current case', async () => {
    const firstInfo = deferred<unknown>()
    const mocks = installMockApi(fakeDataInfo)
    const secondInfo = { ...fakeDataInfo, import_file_name: 'second.vcf', platform: 'Genome' }
    const secondIds = [{ id_type: 'LAB', id_value: 'second' }]
    window.api.caseMetadata.getDataInfo = vi.fn((caseId) =>
      caseId === 1 ? firstInfo.promise : Promise.resolve(secondInfo)
    )
    window.api.caseMetadata.listExternalIds = vi.fn((caseId) =>
      Promise.resolve(caseId === 1 ? fakeExternalIds : secondIds)
    )

    const wrapper = mountTab()
    await wrapper.setProps({ caseId: 2 })
    await flushPromises()

    const vm = wrapper.vm as unknown as CaseDataInfoTabVm
    expect(vm.dataInfo).toEqual(secondInfo)
    expect(vm.externalIds).toEqual(secondIds)

    firstInfo.resolve(fakeDataInfo)
    await flushPromises()

    expect(vm.dataInfo).toEqual(secondInfo)
    expect(vm.externalIds).toEqual(secondIds)
    await vm.save()
    expect(mocks.upsertDataInfo).toHaveBeenLastCalledWith(
      2,
      expect.objectContaining({ platform: 'Genome' })
    )
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

describe('CaseDataInfoTab addExternalId()', () => {
  it('logs a warning and does not refresh the list when upsertExternalId fails (discard-write regression guard)', async () => {
    const mocks = installMockApi(fakeDataInfo, {
      upsertExternalId: fakeSerializableError
    })

    const wrapper = mountTab()
    await flushPromises()
    vi.mocked(logService.warn).mockClear()
    mocks.listExternalIds.mockClear()
    mocks.distinctExternalIdTypes.mockClear()

    const vm = wrapper.vm as unknown as CaseDataInfoTabVm
    await vm.addExternalId('MRN', '99999')

    expect(mocks.upsertExternalId).toHaveBeenCalledWith(1, 'MRN', '99999')
    // Before the fix, a raw (un-unwrapped) await never threw, so the refresh
    // calls below ran unconditionally and no warning was logged for a
    // failed insert.
    expect(mocks.listExternalIds).not.toHaveBeenCalled()
    expect(mocks.distinctExternalIdTypes).not.toHaveBeenCalled()
    expect(logService.warn).toHaveBeenCalledWith(expect.stringContaining('boom'), 'case-data-info')
  })

  it('refreshes the list on success', async () => {
    installMockApi(fakeDataInfo)

    const wrapper = mountTab()
    await flushPromises()
    vi.mocked(logService.warn).mockClear()

    const vm = wrapper.vm as unknown as CaseDataInfoTabVm
    await vm.addExternalId('MRN', '99999')

    expect(logService.warn).not.toHaveBeenCalled()
    expect(vm.externalIds).toEqual(fakeExternalIds)
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

  it('does not apply an old case deletion after a new case has loaded', async () => {
    const pendingDelete = deferred<unknown>()
    const mocks = installMockApi(fakeDataInfo)
    const wrapper = mountTab()
    await flushPromises()
    mocks.deleteExternalId.mockReturnValueOnce(pendingDelete.promise)

    const vm = wrapper.vm as unknown as CaseDataInfoTabVm
    const deletion = vm.deleteExternalId('MRN')
    await wrapper.setProps({ caseId: 2 })
    await flushPromises()
    expect(vm.externalIds).toEqual(fakeExternalIds)

    pendingDelete.resolve(undefined)
    await deletion

    expect(vm.externalIds).toEqual(fakeExternalIds)
  })
})

describe('CaseDataInfoTab child-dialog case authority', () => {
  it('ignores a gene-list save emitted after another case loads', async () => {
    const mocks = installMockApi(fakeDataInfo)
    const wrapper = mountTab()
    await flushPromises()
    const vm = wrapper.vm as unknown as CaseDataInfoTabVm
    vm.openGeneListEditor()

    window.api.caseMetadata.getDataInfo = vi
      .fn()
      .mockResolvedValue({ ...fakeDataInfo, gene_list_id: 77 })
    await wrapper.setProps({ caseId: 2 })
    await flushPromises()
    mocks.upsertDataInfo.mockClear()

    await vm.onGeneListSaved({
      listId: 99,
      geneLists: [{ id: 99, name: 'Old case genes', gene_count: 3 }]
    })

    expect(mocks.upsertDataInfo).not.toHaveBeenCalled()
    await vm.save()
    expect(mocks.upsertDataInfo).toHaveBeenCalledWith(
      2,
      expect.objectContaining({ gene_list_id: 77 })
    )
  })

  it('ignores a gene-list delete emitted after another case loads', async () => {
    const mocks = installMockApi(fakeDataInfo)
    const wrapper = mountTab()
    await flushPromises()
    const vm = wrapper.vm as unknown as CaseDataInfoTabVm
    vm.openGeneListEditor()

    window.api.caseMetadata.getDataInfo = vi
      .fn()
      .mockResolvedValue({ ...fakeDataInfo, gene_list_id: 77 })
    await wrapper.setProps({ caseId: 2 })
    await flushPromises()
    mocks.upsertDataInfo.mockClear()

    await vm.onGeneListDeleted({ geneLists: [] })

    expect(mocks.upsertDataInfo).not.toHaveBeenCalled()
    await vm.save()
    expect(mocks.upsertDataInfo).toHaveBeenCalledWith(
      2,
      expect.objectContaining({ gene_list_id: 77 })
    )
  })

  it('ignores a region-file import emitted after another case loads', async () => {
    const mocks = installMockApi(fakeDataInfo)
    const wrapper = mountTab()
    await flushPromises()
    const vm = wrapper.vm as unknown as CaseDataInfoTabVm
    vm.openRegionFileImport()

    window.api.caseMetadata.getDataInfo = vi
      .fn()
      .mockResolvedValue({ ...fakeDataInfo, region_file_id: 88 })
    await wrapper.setProps({ caseId: 2 })
    await flushPromises()
    mocks.upsertDataInfo.mockClear()

    await vm.onRegionFileImported({
      regionFileId: 99,
      regionFiles: [{ id: 99, name: 'Old case regions', region_count: 4, total_bases: 400 }]
    })

    expect(mocks.upsertDataInfo).not.toHaveBeenCalled()
    await vm.save()
    expect(mocks.upsertDataInfo).toHaveBeenCalledWith(
      2,
      expect.objectContaining({ region_file_id: 88 })
    )
  })
})
