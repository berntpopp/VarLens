/**
 * The RFC 8252 loopback redirect: a one-shot HTTP listener on 127.0.0.1 that
 * receives the authorization response from the system browser.
 *
 * It answers only `GET /callback` with the expected `state`. A request with
 * another state, from anyone on this machine, gets a 400 and the listener
 * keeps waiting, so a stray request cannot end the sign-in. The page it shows
 * echoes nothing from the request.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'http'
import type { AddressInfo } from 'net'

export interface CallbackResult {
  code?: string
  error?: string
}

export interface LoopbackListener {
  redirectUri: string
  /** Resolves with the authorization response, rejects on timeout or cancel. */
  result: Promise<CallbackResult>
  close(): void
}

const PAGE_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'",
  'referrer-policy': 'no-referrer'
}

function page(response: ServerResponse, status: number, message: string): void {
  response.writeHead(status, PAGE_HEADERS)
  response.end(
    `<!doctype html><meta charset="utf-8"><title>VarLens</title>` +
      `<body style="font-family:sans-serif;margin:3rem"><p>${message}</p></body>`
  )
}

export async function openLoopbackListener(
  state: string,
  timeoutMs: number
): Promise<LoopbackListener> {
  let settle:
    { resolve: (value: CallbackResult) => void; reject: (error: Error) => void } | undefined
  const result = new Promise<CallbackResult>((resolve, reject) => {
    settle = { resolve, reject }
  })
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    let url: URL
    try {
      url = new URL(request.url ?? '/', 'http://127.0.0.1')
    } catch {
      page(response, 400, 'Bad request.')
      return
    }
    if (request.method !== 'GET' || url.pathname !== '/callback') {
      page(response, 404, 'Not found.')
      return
    }
    if (url.searchParams.get('state') !== state) {
      page(response, 400, 'This sign-in link is not for the sign-in VarLens is waiting for.')
      return
    }
    const error = url.searchParams.get('error')
    const code = url.searchParams.get('code')
    if (error !== null || code === null) {
      page(response, 200, 'The sign-in did not complete. Return to VarLens.')
      settle?.resolve({ error: error ?? 'no_code' })
    } else {
      page(
        response,
        200,
        'VarLens received your sign-in. You can close this tab and return to VarLens.'
      )
      settle?.resolve({ code })
    }
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen({ host: '127.0.0.1', port: 0 }, resolve)
  })
  const { port } = server.address() as AddressInfo
  const timer = setTimeout(() => settle?.reject(new Error('The sign-in timed out.')), timeoutMs)
  let closed = false
  const close = (): void => {
    if (closed) return
    closed = true
    clearTimeout(timer)
    server.close()
    server.closeAllConnections()
  }
  void result.then(close, close)
  return {
    redirectUri: `http://127.0.0.1:${port}/callback`,
    result,
    close: () => {
      settle?.reject(new Error('cancelled'))
      close()
    }
  }
}
