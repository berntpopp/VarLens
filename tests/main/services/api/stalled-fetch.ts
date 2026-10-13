/**
 * fetch stand-ins for timeout/abort tests. nock 15's interceptor trips an
 * undici assertion when a delayed reply is aborted, so these tests stub fetch.
 */

/** Headers arrive, the body never does; reading it fails once the request's signal aborts. */
export function stalledBody(init?: RequestInit): Response {
  const signal = init?.signal
  const body = new ReadableStream({
    start(controller) {
      signal?.addEventListener('abort', () => controller.error(signal.reason))
    }
  })
  return new Response(body, { status: 200 })
}

/** No response at all; rejects once the request's signal aborts. */
export function stalledRequest(init?: RequestInit): Promise<Response> {
  return new Promise((_, reject) => {
    init?.signal?.addEventListener('abort', () => reject(init.signal!.reason))
  })
}
