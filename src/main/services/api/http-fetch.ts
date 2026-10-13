/**
 * The one fetch every reference API client uses (#126).
 *
 * Node's global fetch (undici) ignores Chromium's proxy settings, so behind a
 * corporate proxy the clients could not reach the network. Desktop main
 * installs Electron's `net.fetch` at app-ready (Chromium stack: system proxy,
 * PAC and proxy auth). The web server and tests share these clients and must
 * not import `electron`, so they keep the global fetch, looked up per call so
 * test stubs still apply.
 */
type ApiFetch = (url: string, init?: RequestInit) => Promise<Response>

let installed: ApiFetch | null = null

export function setApiFetch(impl: ApiFetch | null): void {
  installed = impl
}

export const apiFetch: ApiFetch = (url, init) => (installed ?? globalThis.fetch)(url, init)
