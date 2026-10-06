/**
 * Runtime feature reads for components: thin, Pinia-aware wrappers around the
 * capability store (`stores/capabilityStore.ts`).
 *
 * Whether a feature is available is decided by the per-session capability
 * document the backend serves (desktop main or the web server), computed from
 * the parity manifest, the runtime and the session role — not by an
 * `isWebRuntime()` branch here. FAIL-CLOSED: without a loaded document (or
 * without an active Pinia) every feature reads as unavailable.
 *
 * User-facing copy lives in src/shared/ipc/capability-features.ts.
 */
import { getActivePinia } from 'pinia'

import type { CapabilityFeature } from '../../../shared/ipc/capability-features'
import { useCapabilityStore } from '../stores/capabilityStore'

export type RuntimeFeature = CapabilityFeature

const NOT_LOADED_REASON = 'Checking which features are available…'

export function isRuntimeFeatureAvailable(feature: RuntimeFeature): boolean {
  if (getActivePinia() === undefined) return false
  return useCapabilityStore().canUse(feature)
}

/** Reason string when unavailable for this session, otherwise null. */
export function runtimeFeatureUnavailableReason(feature: RuntimeFeature): string | null {
  if (getActivePinia() === undefined) return NOT_LOADED_REASON
  return useCapabilityStore().capabilityReason(feature)
}

/** Protein structure / domain / ClinVar-lollipop view (`protein.*`, `gnomad.*`). */
export function isProteinViewerAvailable(): boolean {
  return isRuntimeFeatureAvailable('proteinViewer')
}
