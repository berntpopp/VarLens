/**
 * The one renderer store for "may this session use X here?" (spec §4.3).
 *
 * It loads the per-session capability document from `system.getCapabilities`
 * (desktop main or the web server, both built by
 * src/shared/ipc/capability-document.ts) before the shell renders, and
 * FAILS CLOSED: until a document is loaded every feature reads as unavailable.
 * Storage-backend flags (`backend-capabilities.ts`) and runtime features
 * (`runtime-features.ts`) both read from here.
 */
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import type { CapabilityDocument } from '../../../shared/ipc/capability-document'
import type { CapabilityFeature } from '../../../shared/ipc/capability-features'
import { formatErrorMessage } from '../../../shared/errors/format-error-message'
import { unwrapIpcResult } from '../../../shared/types/errors'
import { logService } from '../services/LogService'
import { useApiService } from '../composables/useApiService'

const LOADING_REASON = 'Checking which features are available…'
const LOAD_FAILED_REASON = 'Feature availability could not be loaded. Reload the page to retry.'

export class CapabilityUnavailableError extends Error {
  constructor(
    readonly feature: CapabilityFeature,
    message: string
  ) {
    super(message)
    this.name = 'CapabilityUnavailableError'
  }
}

export const useCapabilityStore = defineStore('capabilities', () => {
  const document = ref<CapabilityDocument | null>(null)
  const loadError = ref<string | null>(null)
  let inFlight: Promise<void> | null = null

  const loaded = computed(() => document.value !== null)
  const storage = computed(() => document.value?.storage ?? null)
  const role = computed(() => document.value?.role ?? null)
  const runtime = computed(() => document.value?.runtime ?? null)

  async function fetchDocument(): Promise<void> {
    try {
      const { api } = useApiService()
      if (api === undefined) throw new Error('window.api is not available')
      document.value = unwrapIpcResult(await api.system.getCapabilities())
      loadError.value = null
    } catch (error) {
      // Fail closed: keep whatever was loaded before, or nothing.
      loadError.value = formatErrorMessage(error, 'unknown error')
      logService.warn(`Capability document failed to load: ${loadError.value}`, 'capabilities')
    }
  }

  /** (Re)load the document. Concurrent callers share one request. */
  async function load(): Promise<void> {
    inFlight ??= fetchDocument().finally(() => {
      inFlight = null
    })
    await inFlight
  }

  /** True only when a loaded document enables the feature (fail-closed). */
  function canUse(feature: CapabilityFeature): boolean {
    return document.value?.features[feature]?.enabled === true
  }

  /** User-facing reason the feature is unavailable, or null when usable. */
  function capabilityReason(feature: CapabilityFeature): string | null {
    if (canUse(feature)) return null
    if (document.value === null)
      return loadError.value === null ? LOADING_REASON : LOAD_FAILED_REASON
    return document.value.features[feature]?.reason ?? LOAD_FAILED_REASON
  }

  /** Throw a typed error unless the feature is usable (for store actions). */
  function requireCapability(feature: CapabilityFeature): void {
    const reason = capabilityReason(feature)
    if (reason !== null) throw new CapabilityUnavailableError(feature, reason)
  }

  /** Test seam: install a document without IPC. */
  function setDocument(next: CapabilityDocument | null): void {
    document.value = next
    loadError.value = null
  }

  return {
    document,
    loadError,
    loaded,
    storage,
    role,
    runtime,
    load,
    canUse,
    capabilityReason,
    requireCapability,
    setDocument
  }
})
