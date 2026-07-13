/**
 * Tests for CaseMetadataCard's `handleCreateCohort` error surfacing.
 *
 * `createAndAssignCohort` (useCaseMetadata.ts) has no internal try/catch —
 * unlike its optimistic-update siblings (updateStatus/setCaseCohorts/etc.)
 * it throws when `api.caseMetadata.createCohort` resolves a
 * `SerializableError` (e.g. a UNIQUE-constraint violation on a duplicate
 * cohort name). Before this fix, `handleCreateCohort` awaited it with no
 * try/catch, so a duplicate name produced an unhandled promise rejection
 * instead of a user-visible error. The fix surfaces the failure via the
 * app's existing global snackbar (`useAppState().showSnack`, the same
 * mechanism `CaseView.vue` uses for export errors).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import CaseMetadataCard from '../../../src/renderer/src/components/CaseMetadataCard.vue'
import CohortCombobox from '../../../src/renderer/src/components/CohortCombobox.vue'
import HpoTermSelector from '../../../src/renderer/src/components/HpoTermSelector.vue'
import { useCaseMetadata } from '../../../src/renderer/src/composables/useCaseMetadata'
import { AppStateKey, createAppState } from '../../../src/renderer/src/composables/useAppState'
import { createMockApi } from '../../utils/mock-api'
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
const fakeSerializableError = {
  code: 'DB_ERROR',
  message: 'UNIQUE constraint failed: cohort_groups.name',
  userMessage: 'A cohort with this name already exists'
}

function mountCard(caseId = 1) {
  const state = createAppState()
  // Spy BEFORE mounting: CaseMetadataCard destructures `showSnack` out of
  // useAppState() during setup, capturing the function reference at that
  // point. Spying after mount would replace `state.showSnack` without
  // affecting the reference already captured by the component's closure.
  const showSnackSpy = vi.spyOn(state, 'showSnack')
  const wrapper = mount(CaseMetadataCard, {
    props: { caseId },
    global: {
      plugins: [vuetify],
      provide: {
        [AppStateKey as symbol]: state
      }
    }
  })
  return { wrapper, state, showSnackSpy }
}

describe('CaseMetadataCard — handleCreateCohort', () => {
  beforeEach(() => {
    window.api = createMockApi()
    vi.clearAllMocks()
  })

  afterEach(() => {
    // metadataCache/cohortGroupsCache are module-level singletons shared by
    // every useCaseMetadata() call — reset them so state from one test can't
    // leak into the next.
    useCaseMetadata().clearCache()
  })

  it('shows an error snackbar when creating a duplicate-named cohort fails', async () => {
    window.api.caseMetadata.createCohort = vi.fn().mockResolvedValue(fakeSerializableError)
    const { wrapper, showSnackSpy } = mountCard(1)
    await flushPromises()

    const combobox = wrapper.findComponent(CohortCombobox)
    await combobox.vm.$emit('create:cohort', 'dup')
    await flushPromises()

    expect(showSnackSpy).toHaveBeenCalledWith(
      'A cohort with this name already exists',
      'error',
      expect.objectContaining({ timeout: expect.any(Number) })
    )
    expect(logService.error).toHaveBeenCalled()
    // No unhandled rejection: emit() resolving is enough proof the handler
    // caught the throw rather than letting it propagate.
  })

  it('creates and assigns a cohort without a snackbar on success', async () => {
    window.api.caseMetadata.createCohort = vi.fn().mockResolvedValue({
      id: 7,
      name: 'Trio A',
      description: null,
      created_at: 1_700_000_000_000
    })
    window.api.caseMetadata.assignCohort = vi.fn().mockResolvedValue(undefined)
    const { wrapper, showSnackSpy } = mountCard(1)
    await flushPromises()

    const combobox = wrapper.findComponent(CohortCombobox)
    await combobox.vm.$emit('create:cohort', 'Trio A')
    await flushPromises()

    expect(showSnackSpy).not.toHaveBeenCalled()
    expect(wrapper.emitted('changed')).toBeTruthy()
  })

  it('does not emit changed when a resolved setCohorts error is propagated', async () => {
    window.api.caseMetadata.setCohorts = vi.fn().mockResolvedValue(fakeSerializableError)
    window.api.caseMetadata.getFullMetadata = vi.fn().mockResolvedValue({
      metadata: null,
      cohorts: [],
      hpoTerms: [],
      comments: [],
      metrics: [],
      dataInfo: null,
      externalIds: []
    })
    const { wrapper, showSnackSpy } = mountCard(1)
    await flushPromises()

    await wrapper.findComponent(CohortCombobox).vm.$emit('update:modelValue', [])
    await flushPromises()

    expect(wrapper.emitted('changed')).toBeFalsy()
    expect(showSnackSpy).toHaveBeenCalledWith(
      'A cohort with this name already exists',
      'error',
      expect.objectContaining({ timeout: expect.any(Number) })
    )
  })

  it('does not emit changed when a resolved HPO assignment error is propagated', async () => {
    window.api.caseMetadata.assignHpoTerm = vi.fn().mockResolvedValue(fakeSerializableError)
    const { wrapper, showSnackSpy } = mountCard(1)
    await flushPromises()

    await wrapper
      .findComponent(HpoTermSelector)
      .vm.$emit('add:term', { hpoId: 'HP:0001250', hpoLabel: 'Seizure' })
    await flushPromises()

    expect(wrapper.emitted('changed')).toBeFalsy()
    expect(showSnackSpy).toHaveBeenCalledWith(
      'A cohort with this name already exists',
      'error',
      expect.objectContaining({ timeout: expect.any(Number) })
    )
  })
})
