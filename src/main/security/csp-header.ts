/**
 * Authoritative session-level Content-Security-Policy response header.
 *
 * This MUST stay in lockstep with the meta CSP in `src/renderer/index.html`
 * and `src/web/index.html` (Codex F-08) — those files carry the full
 * rationale comment for each directive. This module mirrors that same
 * policy string, plus `frame-ancestors 'none'`, which meta tags cannot
 * express (it must be set via a response header). There is no dev/prod
 * split — one uniform policy.
 *
 * `'unsafe-eval'` is REQUIRED by the bundled Mol* / pdbe-molstar worker
 * runtime (PR-G G0 spike) — do not remove it from `script-src`. See
 * `tests/e2e/csp-molstar-eval.e2e.ts` for the regression guard.
 *
 * `tests/main/security/csp-header.test.ts` asserts this stays byte-identical
 * to the meta CSP's `script-src` directive by reading it from
 * `src/renderer/index.html` at test time (anti-drift guard).
 */
const CSP_DIRECTIVES: readonly string[] = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval' blob:",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "connect-src 'self' data: https://alphafold.ebi.ac.uk https://www.ebi.ac.uk " +
    'https://files.rcsb.org https://models.rcsb.org https://data.rcsb.org ' +
    'https://rest.ensembl.org https://gnomad.broadinstitute.org ' +
    'https://www.proteins.uniprot.org https://rest.uniprot.org ' +
    'https://www.interpro.ebi.ac.uk blob:',
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  // Header-only directive: meta tags cannot express frame-ancestors. Blocks
  // the app document from being framed/clickjacked.
  "frame-ancestors 'none'"
]

/**
 * Builds the Content-Security-Policy string to attach as an authoritative
 * response header on the app's top-level document.
 */
export function buildContentSecurityPolicy(): string {
  return CSP_DIRECTIVES.join('; ')
}
