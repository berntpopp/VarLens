import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'

import ExternalLookupsSettings from '../../../src/renderer/src/components/account/ExternalLookupsSettings.vue'
import {
  buildReferenceServicesStatus,
  uniformReferenceServicePolicy
} from '../../../src/shared/ipc/domains/reference-services'
import { createMockApi } from '../../utils/mock-api'
import { computeCapabilityDocument } from '../../../src/shared/ipc/capability-document'
import { installCapabilities } from '../helpers/capabilities'

const vuetify = createVuetify({ components, directives })
type TestWindow = Window & { api?: unknown }

describe('ExternalLookupsSettings (admin egress policy)', () => {
  let api: ReturnType<typeof createMockApi>

  beforeEach(() => {
    installCapabilities({ runtime: 'web', role: 'admin' })
    api = createMockApi()
    ;(window as TestWindow).api = api
    const system = api.system as unknown as Record<string, unknown>
    system.getCapabilities = vi
      .fn()
      .mockResolvedValue(
        computeCapabilityDocument({ runtime: 'web', role: 'admin', storage: null })
      )
    const off = buildReferenceServicesStatus('web', uniformReferenceServicePolicy(false))
    api.referenceServices.status.mockResolvedValue(off)
    api.referenceServices.setPolicy.mockImplementation(async (update) =>
      buildReferenceServicesStatus('web', { ...uniformReferenceServicePolicy(false), ...update })
    )
  })

  it('one switch enables every protein view source and refreshes capabilities', async () => {
    const wrapper = mount(ExternalLookupsSettings, { global: { plugins: [vuetify] } })
    await flushPromises()

    const group = wrapper.get('[data-testid="external-lookup-group-protein-view"]')
    expect(group.text()).toContain('Protein view sources')
    expect(group.text()).toContain('gnomAD')

    await wrapper
      .get('[data-testid="external-lookup-group-switch-protein-view"] input')
      .setValue(true)
    await flushPromises()

    expect(api.referenceServices.setPolicy).toHaveBeenCalledWith({ protein: true, gnomad: true })
    expect(
      (api.system as unknown as { getCapabilities: unknown }).getCapabilities
    ).toHaveBeenCalled()
    wrapper.unmount()
  })
})
