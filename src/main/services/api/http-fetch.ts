/**
 * The one fetch every reference API client uses (#126).
 *
 * Node's global fetch (undici) ignores Chromium's proxy settings, so behind a
 * corporate proxy the clients could not reach the network. Desktop main
 * installs Electron's `net.fetch` at app-ready (Chromium stack: system proxy
 * and PAC; integrated Windows auth works, but there is no credential prompt,
 * so a Basic-auth proxy answers 407). The web server and tests share these
 * clients and must not import `electron`, so they keep the global fetch,
 * looked up per call so test stubs still apply.
 */
type ApiFetch = (url: string, init?: RequestInit) => Promise<Response>

let installed: ApiFetch | null = null

export function setApiFetch(impl: ApiFetch | null): void {
  installed = impl
}

export const apiFetch: ApiFetch = (url, init) => (installed ?? globalThis.fetch)(url, init)

const BODY_READS = ['json', 'text', 'arrayBuffer', 'blob', 'formData', 'bytes'] as const

/**
 * Adapts Electron's net.fetch to Node fetch semantics the clients rely on:
 * an aborted request (also mid-body) rejects with `signal.reason` (e.g. the
 * TimeoutError a retry keys on) rather than a bare AbortError, and no
 * default-session cookies go to or come from third-party API hosts.
 */
export function desktopApiFetch(netFetch: ApiFetch): ApiFetch {
  return async (url, init) => {
    const signal = init?.signal
    const reasonIfAborted = (error: unknown): never => {
      throw signal?.aborted === true ? signal.reason : error
    }
    const response = await netFetch(url, { ...init, credentials: 'omit' }).catch(reasonIfAborted)
    for (const method of BODY_READS) {
      const read = response[method].bind(response) as () => Promise<unknown>
      Object.defineProperty(response, method, { value: () => read().catch(reasonIfAborted) })
    }
    return response
  }
}
