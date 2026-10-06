/**
 * On-the-fly brotli/gzip compression for buffered text responses
 * (JSON API payloads, the login page, error bodies).
 *
 * Static bundle files are NOT handled here: they are precompressed at build
 * time (`.br` / `.gz` siblings, see `vite.web-renderer.config.ts`) and served
 * by `@fastify/static` with `preCompressed: true`. Those replies are streams,
 * and anything that is a stream or already carries `content-encoding` is left
 * untouched by this hook.
 */
import { promisify } from 'node:util'
import { brotliCompress, constants as zlibConstants, gzip } from 'node:zlib'

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

const brotliCompressAsync = promisify(brotliCompress)
const gzipAsync = promisify(gzip)

/** Below ~1 KB the framing overhead and CPU cost outweigh the byte savings. */
export const DEFAULT_COMPRESSION_THRESHOLD_BYTES = 1024

const COMPRESSIBLE_TYPE =
  /^(?:application\/(?:json|[\w.+-]+\+json|javascript|xml)|text\/|image\/svg\+xml)/i

type Encoding = 'br' | 'gzip'

/**
 * Pick the best supported encoding from an `Accept-Encoding` header,
 * preferring brotli. Encodings with `q=0` are treated as refused.
 */
export function negotiateEncoding(header: string | undefined): Encoding | null {
  if (header === undefined || header.trim() === '') return null
  const accepted = new Map<string, number>()
  for (const part of header.split(',')) {
    const [rawName, ...params] = part.trim().split(';')
    const name = rawName.trim().toLowerCase()
    if (name === '') continue
    const qParam = params.map((p) => p.trim()).find((p) => p.startsWith('q='))
    const q = qParam === undefined ? 1 : Number.parseFloat(qParam.slice(2))
    accepted.set(name, Number.isFinite(q) ? q : 0)
  }
  const wildcard = accepted.get('*')
  const quality = (name: Encoding): number => accepted.get(name) ?? wildcard ?? 0
  if (quality('br') > 0) return 'br'
  if (quality('gzip') > 0) return 'gzip'
  return null
}

function appendVary(reply: FastifyReply, value: string): void {
  const existing = reply.getHeader('vary')
  if (existing === undefined) {
    reply.header('vary', value)
    return
  }
  const current = String(existing)
  if (current === '*' || current.toLowerCase().includes(value.toLowerCase())) return
  reply.header('vary', `${current}, ${value}`)
}

function shouldCompress(
  request: FastifyRequest,
  reply: FastifyReply,
  payload: unknown,
  threshold: number
): payload is string | Buffer {
  if (typeof payload !== 'string' && !Buffer.isBuffer(payload)) return false
  if (request.method === 'HEAD') return false
  if (reply.statusCode === 204 || reply.statusCode === 304) return false
  if (reply.getHeader('content-encoding') !== undefined) return false
  const contentType = String(reply.getHeader('content-type') ?? '')
  if (!COMPRESSIBLE_TYPE.test(contentType)) return false
  return Buffer.byteLength(payload) >= threshold
}

export function registerResponseCompression(
  app: FastifyInstance,
  options: { thresholdBytes?: number } = {}
): void {
  const threshold = options.thresholdBytes ?? DEFAULT_COMPRESSION_THRESHOLD_BYTES

  app.addHook('onSend', async (request, reply, payload) => {
    if (!shouldCompress(request, reply, payload, threshold)) return payload
    appendVary(reply, 'Accept-Encoding')
    const encoding = negotiateEncoding(request.headers['accept-encoding'])
    if (encoding === null) return payload

    const input = typeof payload === 'string' ? Buffer.from(payload) : payload
    // Brotli quality 4 is the usual dynamic-content sweet spot: close to gzip -9
    // ratios at a fraction of the CPU cost of the default quality 11.
    const compressed =
      encoding === 'br'
        ? await brotliCompressAsync(input, {
            params: {
              [zlibConstants.BROTLI_PARAM_QUALITY]: 4,
              [zlibConstants.BROTLI_PARAM_SIZE_HINT]: input.length
            }
          })
        : await gzipAsync(input, { level: 6 })

    reply.header('content-encoding', encoding)
    reply.removeHeader('content-length')
    return compressed
  })
}
