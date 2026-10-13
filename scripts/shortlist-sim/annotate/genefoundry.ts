/**
 * Minimal JSON-RPC client for the stateless genefoundry link endpoints. Only public pool
 * variants are ever sent through this module.
 */
export type Server = 'vep-link' | 'gnomad-link'

export class GenefoundryToolError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retryable: boolean
  ) {
    super(message)
  }
}

const RETRY_STATUS = (s: number): boolean => s === 429 || s >= 500
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
let nextId = 1

/** Accepts plain JSON or an SSE body (`event: message\ndata: {...}`). */
export function parseRpcBody(text: string): Record<string, unknown> {
  const trimmed = text.trim()
  if (trimmed.startsWith('{')) return JSON.parse(trimmed) as Record<string, unknown>
  const data = trimmed
    .split('\n')
    .filter((l) => l.startsWith('data:'))
    .map((l) => l.slice(5).trim())
    .join('')
  return JSON.parse(data) as Record<string, unknown>
}

function unwrap<T>(rpc: Record<string, unknown>): T {
  const err = rpc.error as { message?: string; code?: number } | undefined
  if (err) throw new GenefoundryToolError(err.message ?? 'JSON-RPC error', String(err.code), false)
  const result = rpc.result as {
    structuredContent?: unknown
    content?: Array<{ text?: string }>
    isError?: boolean
  }
  let payload: unknown = result?.structuredContent
  if (payload === undefined) {
    const text = result?.content?.[0]?.text ?? ''
    try {
      payload = JSON.parse(text)
    } catch {
      throw new GenefoundryToolError(
        text.slice(0, 300) || 'empty tool result',
        'unparsable',
        !!result?.isError
      )
    }
  }
  const p = payload as {
    success?: boolean
    error_code?: string
    message?: string
    retryable?: boolean
  }
  if (p?.success === false || result?.isError === true) {
    const code = p?.error_code ?? 'tool_error'
    const retryable = p?.retryable === true || code === 'rate_limited'
    throw new GenefoundryToolError(p?.message ?? code, code, retryable)
  }
  return payload as T
}

export async function callTool<T>(
  server: Server,
  name: string,
  args: object,
  opts: { retries?: number; timeoutMs?: number; baseDelayMs?: number } = {}
): Promise<T> {
  const retries = opts.retries ?? 5
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: nextId++,
    method: 'tools/call',
    params: { name, arguments: args }
  })
  for (let attempt = 0; ; attempt++) {
    const delay = (opts.baseDelayMs ?? 1000) * 2 ** attempt
    let retryable: boolean
    let error: Error
    try {
      const res = await fetch(`https://${server}.genefoundry.org/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream'
        },
        body,
        signal: AbortSignal.timeout(opts.timeoutMs ?? 180_000)
      })
      if (!res.ok) {
        error = new Error(`${server} ${name}: HTTP ${res.status}`)
        retryable = RETRY_STATUS(res.status)
      } else {
        return unwrap<T>(parseRpcBody(await res.text()))
      }
    } catch (e) {
      error = e instanceof Error ? e : new Error(String(e))
      retryable = e instanceof GenefoundryToolError ? e.retryable : true // network/timeout
    }
    if (!retryable || attempt >= retries) throw error
    await sleep(delay)
  }
}

/** Run `fn` over `items` with at most `limit` in flight. */
export async function pool<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  let i = 0
  const worker = async (): Promise<void> => {
    while (i < items.length) await fn(items[i++])
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
}
