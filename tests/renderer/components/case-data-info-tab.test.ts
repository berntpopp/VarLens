/**
 * Tests for CaseDataInfoTab.vue's loader.
 *
 * `wrapHandler` in the main process *resolves* an `IpcResult<T>` on failure
 * (it never rejects), so a raw `await api.caseMetadata.getDataInfo(...)`
 * returns a `SerializableError` object as if it were data. The loader must
 * pass every `caseMetadata.*` result through `unwrapIpcResult(...)` so a
 * failure throws into the surrounding try/catch instead of being stored as
 * `dataInfo`/`externalIds`/`platformSuggestions`/`idTypeSuggestions`.
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

function installMockApi(getDataInfoResolvedValue: unknown): void {
  ;(window as unknown as Record<string, unknown>).api = {
    caseMetadata: {
      getDataInfo: vi.fn().mockResolvedValue(getDataInfoResolvedValue),
      listExternalIds: vi.fn().mockResolvedValue(fakeExternalIds),
      distinctPlatforms: vi.fn().mockResolvedValue(['CustomPlatformXYZ']),
      distinctExternalIdTypes: vi.fn().mockResolvedValue(['MRN']),
      upsertDataInfo: vi.fn().mockResolvedValue(undefined),
      upsertExternalId: vi.fn().mockResolvedValue(undefined),
      deleteExternalId: vi.fn().mockResolvedValue(undefined)
    },
    geneLists: {
      list: vi.fn().mockResolvedValue([])
    },
    regionFiles: {
      list: vi.fn().mockResolvedValue([])
    }
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
})
