/**
 * Client-side feature flags for capabilities that depend on the runtime
 * (Electron desktop vs. hosted web), not on the storage backend.
 *
 * Storage-backend capabilities live in `backend-capabilities.ts` and come
 * from the server. External reference lookups (VEP, MyVariant, SpliceAI,
 * gnomAD, protein view, PanelApp, STRING) are an admin-controlled server
 * setting in web mode and live in `stores/referenceServicesStore.ts`. HPO term
 * search and BED export work in both runtimes.
 *
 * What remains here is genuinely desktop-only: the web image owns its
 * bundled gene reference file.
 */
import { isWebRuntime } from './runtime-mode'

export type RuntimeFeature =
  /** gene-ref:checkUpdates / update rebuild the bundled file; the web image owns it. */
  'geneRefUpdate'

const WEB_UNAVAILABLE: ReadonlySet<RuntimeFeature> = new Set<RuntimeFeature>(['geneRefUpdate'])

/** User-facing copy for a feature that is unavailable in this runtime. */
export const WEB_UNAVAILABLE_MESSAGE: Record<RuntimeFeature, string> = {
  geneRefUpdate: 'The gene reference is part of the server installation and cannot be updated here.'
}

export function isRuntimeFeatureAvailable(
  feature: RuntimeFeature,
  web: boolean = isWebRuntime()
): boolean {
  return !(web && WEB_UNAVAILABLE.has(feature))
}

/** Reason string when unavailable in this runtime, otherwise null. */
export function runtimeFeatureUnavailableReason(
  feature: RuntimeFeature,
  web: boolean = isWebRuntime()
): string | null {
  return isRuntimeFeatureAvailable(feature, web) ? null : WEB_UNAVAILABLE_MESSAGE[feature]
}
