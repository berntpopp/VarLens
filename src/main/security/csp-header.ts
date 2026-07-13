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
 * `'unsafe-eval'` is REQUIRED by the bundled pdbe-molstar dependency chain:
 * pdbe-molstar@3.12.0 statically imports Mol*'s MP4 export, which imports
 * h264-mp4-encoder@1.0.12. Its Emscripten web bundle executes
 * `new Function("body", ...)` in `createNamedFunction` while initializing
 * embind error classes. See `tests/e2e/csp-molstar-eval.e2e.ts`.
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

export type AppDocumentUrlPredicate = (url: string) => boolean

/**
 * Build the session `onHeadersReceived` listener for renderer documents.
 *
 * `frame-ancestors` is evaluated on the response of the document being
 * framed. Electron reports that response as `subFrame`, so limiting the
 * header to `mainFrame` would silently disable the clickjacking protection
 * in the exact context it is meant to cover. URL authority stays injected:
 * unrelated documents and ordinary subresources must keep their own headers.
 */
export function createContentSecurityPolicyHeaderHandler(
  isAppDocumentUrl: AppDocumentUrlPredicate
): (
  details: Electron.OnHeadersReceivedListenerDetails,
  callback: (response: Electron.HeadersReceivedResponse) => void
) => void {
  const policy = buildContentSecurityPolicy()

  return (details, callback): void => {
    const isDocument = details.resourceType === 'mainFrame' || details.resourceType === 'subFrame'
    if (!isDocument || !isAppDocumentUrl(details.url)) {
      callback({ responseHeaders: details.responseHeaders })
      return
    }

    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [policy]
      }
    })
  }
}
