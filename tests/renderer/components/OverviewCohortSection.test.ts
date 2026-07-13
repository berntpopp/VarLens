/**
 * Tests for OverviewCohortSection.vue's cohort edit/delete IpcResult
 * unwrapping.
 *
 * `wrapHandler` in the main process *resolves* an `IpcResult<T>` even on
 * failure — it never rejects. `saveCohortEdit()` / `executeDeleteCohort()`
 * used to `await api.caseMetadata.updateCohort(...)` / `deleteCohort(...)`
 * and discard the result, relying on a surrounding `try/catch` that is dead
 * for IPC errors. On failure (e.g. renaming a cohort to a name that already
 * exists — a UNIQUE constraint violation), the code ran `cancelCohortEdit()`
 * / `emit('refresh')` as if the write had succeeded: a silent failure with
 * nothing surfaced to the user.
 *
 * This suite proves the failure path now throws (via `unwrapIpcResult`),
 * does NOT close the edit form / delete dialog or emit `refresh` as if it
 * succeeded, and surfaces the error via the component's error snackbar
 * (mirroring the `errorSnackbar`/`errorSnackbarText` pattern already used by
 * PanelManagerDialog.vue).
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'

vi.mock('../../../src/renderer/src/services/LogService', () => ({
  logService: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}))

import OverviewCohortSection from '../../../src/renderer/src/components/database-overview/OverviewCohortSection.vue'
import { logService } from '../../../src/renderer/src/services/LogService'
import type { OverviewCohortGroup } from '../../../src/shared/types/database-overview'

const vuetify = createVuetify({ components, directives })

// Runtime shape of a main-process SerializableError (src/shared/types/errors.ts).
// isIpcError discriminates on code/message/userMessage — there is no
// __isSerializableError marker field.
const fakeSerializableError = {
  code: 'DB_ERROR',
  message: 'UNIQUE constraint failed: cohort_groups.name',
  userMessage: 'A cohort group with this name already exists'
}

const groupA: OverviewCohortGroup = {
  id: 1,
  name: 'GroupA',
  description: null,
  created_at: 1_700_000_000_000,
  member_count: 2
}

interface OverviewCohortSectionVm {
  editingCohort: OverviewCohortGroup | null
  cohortEditForm: { name: string; description: string }
  cohortToDelete: OverviewCohortGroup | null
  cohortDeleteDialog: boolean
  errorSnackbar: boolean
  errorSnackbarText: string
  startEditCohort: (group: OverviewCohortGroup) => void
  saveCohortEdit: () => Promise<void>
  confirmDeleteCohort: (group: OverviewCohortGroup) => void
  executeDeleteCohort: () => Promise<void>
}

function installMockApi(overrides: { updateCohort?: unknown; deleteCohort?: unknown }): {
  updateCohort: ReturnType<typeof vi.fn>
  deleteCohort: ReturnType<typeof vi.fn>
} {
  const updateCohort = vi.fn().mockResolvedValue(overrides.updateCohort ?? { ...groupA })
  const deleteCohort = vi.fn().mockResolvedValue(overrides.deleteCohort ?? undefined)
  ;(window as unknown as Record<string, unknown>).api = {
    caseMetadata: { updateCohort, deleteCohort }
  }
  return { updateCohort, deleteCohort }
}

function mountSection(): VueWrapper<InstanceType<typeof OverviewCohortSection>> {
  return mount(OverviewCohortSection, {
    props: { cohortGroups: [groupA] },
    global: { plugins: [vuetify] }
  })
}

describe('OverviewCohortSection — cohort edit/delete IpcResult unwrapping', () => {
  let wrapper: VueWrapper<InstanceType<typeof OverviewCohortSection>>

  afterEach(() => {
    wrapper?.unmount()
    vi.clearAllMocks()
  })

  describe('saveCohortEdit', () => {
    it('closes the edit form and emits refresh on success', async () => {
      installMockApi({})
      wrapper = mountSection()
      const vm = wrapper.vm as unknown as OverviewCohortSectionVm

      vm.startEditCohort(groupA)
      vm.cohortEditForm.name = 'Renamed Group'
      await vm.saveCohortEdit()

      expect(vm.editingCohort).toBeNull()
      expect(wrapper.emitted('refresh')).toHaveLength(1)
      expect(vm.errorSnackbar).toBe(false)
    })

    it('does NOT close the edit form or emit refresh when updateCohort fails, and surfaces the error', async () => {
      installMockApi({ updateCohort: fakeSerializableError })
      wrapper = mountSection()
      const vm = wrapper.vm as unknown as OverviewCohortSectionVm

      vm.startEditCohort(groupA)
      vm.cohortEditForm.name = 'Renamed Group'
      await vm.saveCohortEdit()

      // Must NOT run the success branch: the form stays open, no refresh.
      expect(vm.editingCohort).toEqual(groupA)
      expect(wrapper.emitted('refresh')).toBeUndefined()

      // Must surface the error, not swallow it.
      expect(vm.errorSnackbar).toBe(true)
      expect(vm.errorSnackbarText).toBe('A cohort group with this name already exists')
      expect(logService.error).toHaveBeenCalledWith(
        expect.stringContaining('A cohort group with this name already exists'),
        'cohort'
      )
    })
  })

  describe('executeDeleteCohort', () => {
    it('closes the confirmation dialog and emits refresh on success', async () => {
      installMockApi({})
      wrapper = mountSection()
      const vm = wrapper.vm as unknown as OverviewCohortSectionVm

      vm.confirmDeleteCohort(groupA)
      await vm.executeDeleteCohort()

      expect(vm.cohortDeleteDialog).toBe(false)
      expect(vm.cohortToDelete).toBeNull()
      expect(wrapper.emitted('refresh')).toHaveLength(1)
      expect(vm.errorSnackbar).toBe(false)
    })

    it('does NOT emit refresh when deleteCohort fails, and surfaces the error', async () => {
      installMockApi({ deleteCohort: fakeSerializableError })
      wrapper = mountSection()
      const vm = wrapper.vm as unknown as OverviewCohortSectionVm

      vm.confirmDeleteCohort(groupA)
      await vm.executeDeleteCohort()

      // Must NOT run the success branch — no refresh emitted despite the
      // dialog/loading state resetting in `finally`.
      expect(wrapper.emitted('refresh')).toBeUndefined()

      // Must surface the error, not swallow it.
      expect(vm.errorSnackbar).toBe(true)
      expect(vm.errorSnackbarText).toBe('A cohort group with this name already exists')
      expect(logService.error).toHaveBeenCalledWith(
        expect.stringContaining('A cohort group with this name already exists'),
        'cohort'
      )
    })
  })
})
