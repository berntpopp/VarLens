/**
 * Which external reference lookups (VEP, MyVariant, SpliceAI, gnomAD,
 * protein view, PanelApp, STRING) this runtime may make.
 *
 * Desktop: always available (no egress policy). Web: an administrator
 * enables each service on the server; the store loads that status once and
 * is FAIL-CLOSED — until the status has loaded, every service reads as
 * unavailable, so the UI never fires a lookup the server would refuse.
 */
import { defineStore, getActivePinia } from 'pinia'
import { ref } from 'vue'

import { useApiService } from '../composables/useApiService'
import { logService } from '../services/LogService'
import { isWebRuntime } from '../utils/runtime-mode'
import { formatErrorMessage } from '../../../shared/errors/format-error-message'
import { unwrapIpcResult } from '../../../shared/types/errors'
import type {
  ReferenceServiceId,
  ReferenceServicePolicyUpdate,
  ReferenceServicesStatus
} from '../../../shared/ipc/domains/reference-services'

const LOADING_REASON = 'Checking whether this lookup is enabled on the server…'
const LOAD_FAILED_REASON =
  'External lookup settings could not be loaded from the server. Reload the page to try again.'

export const useReferenceServicesStore = defineStore('referenceServices', () => {
  const { api } = useApiService()
  const status = ref<ReferenceServicesStatus | null>(null)
  const loadFailed = ref(false)
  let inflight: Promise<void> | null = null

  async function fetchStatus(): Promise<void> {
    if (!api) return
    try {
      status.value = unwrapIpcResult(await api.referenceServices.status())
      loadFailed.value = false
    } catch (error) {
      loadFailed.value = true
      logService.warn(
        `Failed to load reference service status: ${formatErrorMessage(error, 'unknown error')}`,
        'reference-services'
      )
    }
  }

  /** Load once; concurrent callers share the request. `force` refetches. */
  function ensureLoaded(force = false): Promise<void> {
    if (!force && status.value !== null) return Promise.resolve()
    inflight ??= fetchStatus().finally(() => {
      inflight = null
    })
    return inflight
  }

  function isEnabled(id: ReferenceServiceId): boolean {
    if (!isWebRuntime()) return true
    return status.value?.services.find((service) => service.id === id)?.enabled ?? false
  }

  /** User-facing reason when the service is unavailable, otherwise null. */
  function reason(id: ReferenceServiceId): string | null {
    if (!isWebRuntime()) return null
    if (status.value === null) return loadFailed.value ? LOAD_FAILED_REASON : LOADING_REASON
    const service = status.value.services.find((entry) => entry.id === id)
    if (service === undefined) return LOAD_FAILED_REASON
    return service.enabled ? null : service.reason
  }

  async function setPolicy(update: ReferenceServicePolicyUpdate): Promise<void> {
    if (!api) return
    status.value = unwrapIpcResult(await api.referenceServices.setPolicy(update))
  }

  return { status, loadFailed, ensureLoaded, isEnabled, reason, setPolicy }
})

/**
 * Non-component check for composables: desktop → true; web without an active
 * Pinia (or before the status loads) → false (fail-closed).
 */
export function isReferenceServiceEnabled(id: ReferenceServiceId): boolean {
  if (!isWebRuntime()) return true
  if (getActivePinia() === undefined) return false
  return useReferenceServicesStore().isEnabled(id)
}
