/**
 * HTTP transport for the typed web client: `POST {BASE}/api/<domain>/<method>`
 * with `{ args }`. Application errors come back as `SerializableError` JSON and
 * are returned as IPC error envelopes; transport failures throw.
 */
import { isIpcError } from '../../shared/types/errors'

// Vite's `base` config materialises here at build time. The browser
// loads the SPA from BASE_URL (e.g. `/varlens/`), so API calls have to
// share that prefix or reverse-proxy path routing won't match.
export const API_BASE = `${import.meta.env.BASE_URL.replace(/\/$/, '')}/api`

interface InvokeBody {
  args: unknown[]
}

export async function httpInvoke(
  domain: string,
  method: string,
  args: unknown[]
): Promise<unknown> {
  const body: InvokeBody = { args }
  const res = await fetch(`${API_BASE}/${domain}/${method}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })
  // Server returns JSON for both success and application errors
  // (SerializableError). Non-2xx with non-JSON body is a transport
  // failure — surface it.
  const text = await res.text()
  if (!res.ok) {
    try {
      const parsed = JSON.parse(text) as unknown
      if (isIpcError(parsed)) return parsed
    } catch {
      // Throw below for non-JSON error responses.
    }
    throw new Error(`web rpc ${domain}.${method}: ${res.status} ${res.statusText}: ${text}`)
  }
  if (text === '') return undefined
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`web rpc ${domain}.${method}: ${res.status} ${res.statusText}: ${text}`)
  }
}
