/**
 * Client-side feature flags for capabilities that depend on the runtime
 * (Electron desktop vs. hosted web), not on the storage backend.
 *
 * Storage-backend capabilities live in `backend-capabilities.ts` and come
 * from the server. These flags cover features whose web endpoints are
 * intentionally unimplemented, so the renderer must not call them at all:
 * a call would only produce a 404/501 in the browser console.
 */
import { isWebRuntime } from './runtime-mode'

/**
 * Protein structure / domain / ClinVar-lollipop view. The web server answers
 * `protein:*` with 501 and has no `gnomad:getClinVarVariants` route (404);
 * both rely on desktop-side external-API clients.
 */
export function isProteinViewerAvailable(): boolean {
  return !isWebRuntime()
}
