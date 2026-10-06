/**
 * Test helper: install a capability document on the active Pinia (creating one
 * if needed). The capability store fails closed, so renderer tests that
 * exercise gated or storage-flag-dependent code paths must install one, the
 * same way the app loads it before mounting (src/renderer/src/main.ts).
 */
import { createPinia, getActivePinia, setActivePinia } from 'pinia'

import { useCapabilityStore } from '../../../src/renderer/src/stores/capabilityStore'
import { MOCK_SQLITE_CAPABILITIES } from '../../../src/renderer/src/mocks/mockApi'
import {
  computeCapabilityDocument,
  type CapabilityRuntime
} from '../../../src/shared/ipc/capability-document'
import type { StorageCapabilities } from '../../../src/shared/types/storage-capabilities'

export function installCapabilities(
  options: {
    runtime?: CapabilityRuntime
    role?: string
    storage?: StorageCapabilities | null
  } = {}
): void {
  if (getActivePinia() === undefined) setActivePinia(createPinia())
  useCapabilityStore().setDocument(
    computeCapabilityDocument({
      runtime: options.runtime ?? 'desktop',
      role: options.role ?? 'admin',
      storage: options.storage === undefined ? MOCK_SQLITE_CAPABILITIES : options.storage
    })
  )
}
