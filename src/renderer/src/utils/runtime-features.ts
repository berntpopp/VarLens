/**
 * Client-side feature flags for capabilities that depend on the runtime
 * (Electron desktop vs. hosted web), not on the storage backend.
 *
 * Storage-backend capabilities live in `backend-capabilities.ts` and come
 * from the server. These flags cover features whose web endpoints are
 * intentionally unimplemented (501) or absent (404), so the renderer must
 * not call them at all — it shows an explicit "not available in the web
 * version" state instead of an empty result or a console error.
 *
 * Root causes are tracked in
 * .planning/code-review/ui-ux-audit-2026-10-06/followups/track4/settings-admin-inventory.md
 */
import { isWebRuntime } from './runtime-mode'

export type RuntimeFeature =
  /** protein:* answers 501; gnomad:getClinVarVariants has no web route (404). */
  | 'proteinViewer'
  /** hpo:search answers 501 (the HPO ontology client is desktop-side). */
  | 'hpoSearch'
  /** vep:fetch answers 501; myvariant/spliceai have no web routes. */
  | 'vepEnrichment'
  /** panels:searchPanelApp / importPanelApp have no web routes (outbound PanelApp API). */
  | 'panelAppImport'
  /** panels:generateStringDb has no web route (outbound STRING API). */
  | 'stringDbPanels'
  /** gene-ref:checkUpdates / update rebuild the bundled file; the web image owns it. */
  | 'geneRefUpdate'

const WEB_UNAVAILABLE: ReadonlySet<RuntimeFeature> = new Set<RuntimeFeature>([
  'proteinViewer',
  'hpoSearch',
  'vepEnrichment',
  'panelAppImport',
  'stringDbPanels',
  'geneRefUpdate'
])

/** User-facing copy for a feature that is unavailable in this runtime. */
export const WEB_UNAVAILABLE_MESSAGE: Record<RuntimeFeature, string> = {
  proteinViewer: 'The protein view is not available in the web version yet.',
  hpoSearch:
    'HPO term search is not available in the web version yet. Existing terms are shown; add new ones in the desktop app.',
  vepEnrichment: 'Fetching annotations from Ensembl VEP is not available in the web version yet.',
  panelAppImport: 'PanelApp import is not available in the web version yet.',
  stringDbPanels: 'StringDB panel generation is not available in the web version yet.',
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

/**
 * Protein structure / domain / ClinVar-lollipop view. The web server answers
 * `protein:*` with 501 and has no `gnomad:getClinVarVariants` route (404);
 * both rely on desktop-side external-API clients.
 */
export function isProteinViewerAvailable(): boolean {
  return isRuntimeFeatureAvailable('proteinViewer')
}
