/* eslint-disable vue/one-component-per-file -- test doubles for the list's children */
/**
 * A failed delete rejects with the plain `SerializableError` object that
 * `unwrapIpcResult` throws, not an `Error`. The snackbar must show its message,
 * never `[object Object]` (#509).
 */
import { describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'

import CaseList from '../../../src/renderer/src/components/CaseList.vue'

const serializableError = {
  code: 'DATABASE',
  message: 'SQLITE_BUSY: database is locked',
  userMessage: 'The database is busy. Try again.'
}
const caseRow = {
  id: 7,
  name: 'Case X',
  variant_count: 3,
  created_at: 0,
  cohort_names: [],
  affected_status: null,
  sex: null
}

vi.mock('../../../src/renderer/src/services/LogService', () => ({
  logService: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }
}))
vi.mock('../../../src/renderer/src/composables/useApiService', () => ({
  useApiService: () => ({
    api: {
      cases: { query: vi.fn(async () => ({ data: [caseRow], total_count: 1 })) },
      caseMetadata: { distinctHpoTerms: vi.fn(async () => []) }
    }
  })
}))
vi.mock('../../../src/renderer/src/composables/useCaseDeletion', () => ({
  useCaseDeletion: () => ({
    deleteCase: vi.fn(() => Promise.reject(serializableError)),
    deleteCases: vi.fn()
  })
}))
vi.mock('../../../src/renderer/src/composables/useCaseMetadata', () => ({
  getCohortColor: () => 'grey',
  useCaseMetadata: () => ({
    loadCohortGroups: vi.fn(async () => undefined),
    cohortGroupsCache: ref([]),
    metadataCache: ref(new Map())
  })
}))
vi.mock('../../../src/renderer/src/composables/usePermissions', () => ({
  usePermissions: () => ({ canWrite: ref(true) })
}))
vi.mock('../../../src/renderer/src/utils/backend-capabilities', () => ({
  getCurrentUnsupportedReason: vi.fn(async () => null)
}))

const show = vi.fn()
const exposing = (exposed: Record<string, unknown>, emits: string[] = []) =>
  defineComponent({
    emits,
    setup(_, { expose }) {
      expose(exposed)
      return () => h('div')
    }
  })

describe('CaseList — failed delete', () => {
  it('shows the real error message in the snackbar instead of [object Object]', async () => {
    const contextMenu = exposing({ open: vi.fn(), close: vi.fn() }, ['delete'])
    const wrapper = mount(CaseList, {
      global: {
        plugins: [createVuetify({ components, directives })],
        stubs: {
          CaseStatusIcons: true,
          VInfiniteScroll: defineComponent({
            emits: ['load'],
            mounted() {
              this.$emit('load', { side: 'end', done: () => undefined })
            },
            render() {
              return h('div', this.$slots.default?.())
            }
          }),
          CaseContextMenu: contextMenu,
          DeleteCaseDialog: exposing({ show: vi.fn(async () => true) }),
          AppSnackbar: exposing({ show })
        }
      }
    })
    await flushPromises()

    await wrapper.find('.v-list-item').trigger('contextmenu')
    wrapper.findComponent(contextMenu).vm.$emit('delete')
    await flushPromises()

    expect(show).toHaveBeenLastCalledWith(
      'Failed to delete "Case X": The database is busy. Try again.'
    )
    wrapper.unmount()
  })
})
