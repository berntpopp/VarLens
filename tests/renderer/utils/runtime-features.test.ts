import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { computeCapabilityDocument } from '../../../src/shared/ipc/capability-document'
import { CAPABILITY_FEATURES } from '../../../src/shared/ipc/capability-features'
import { useCapabilityStore } from '../../../src/renderer/src/stores/capabilityStore'
import {
  isRuntimeFeatureAvailable,
  runtimeFeatureUnavailableReason,
  type RuntimeFeature
} from '../../../src/renderer/src/utils/runtime-features'

/** Features the web runtime cannot serve in the seeded parity manifest. */
const WEB_GATED: RuntimeFeature[] = [
  'proteinViewer',
  'hpoSearch',
  'vepEnrichment',
  'panelAppImport',
  'stringDbPanels',
  'geneRefUpdate',
  'cohortAssociation',
  'localDatabaseFiles',
  'workerThreads',
  'autoUpdate',
  'igvLocalBroadcast'
]

function install(runtime: 'desktop' | 'web', role = 'user'): void {
  useCapabilityStore().setDocument(computeCapabilityDocument({ runtime, role, storage: null }))
}

describe('runtime feature gating (capability document)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.restoreAllMocks()
  })

  it('fails closed until the capability document is loaded', () => {
    for (const feature of WEB_GATED) {
      expect(isRuntimeFeatureAvailable(feature)).toBe(false)
      expect(runtimeFeatureUnavailableReason(feature)).toMatch(/available/i)
    }
  })

  it('enables every feature on desktop', () => {
    install('desktop', 'admin')
    for (const feature of Object.keys(CAPABILITY_FEATURES) as RuntimeFeature[]) {
      expect(isRuntimeFeatureAvailable(feature), feature).toBe(true)
      expect(runtimeFeatureUnavailableReason(feature)).toBeNull()
    }
  })

  it('disables web gaps with the explicit user-facing reason', () => {
    install('web')
    for (const feature of WEB_GATED) {
      expect(isRuntimeFeatureAvailable(feature), feature).toBe(false)
      expect(runtimeFeatureUnavailableReason(feature)).toBe(
        CAPABILITY_FEATURES[feature].unavailableInWeb
      )
    }
    expect(runtimeFeatureUnavailableReason('hpoSearch')).toMatch(/HPO term search/)
  })

  it('is role-aware: admin-only features need the admin role', () => {
    install('web', 'user')
    expect(isRuntimeFeatureAvailable('userAdmin')).toBe(false)
    expect(runtimeFeatureUnavailableReason('userAdmin')).toMatch(/administrator/)
    install('web', 'admin')
    expect(isRuntimeFeatureAvailable('userAdmin')).toBe(true)
    expect(isRuntimeFeatureAvailable('multiFileImport')).toBe(true)
  })
})
