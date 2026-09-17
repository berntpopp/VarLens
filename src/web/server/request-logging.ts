import type { IncomingMessage } from 'node:http'

const REDACTED_QUERY = '?<redacted>'

// Fastify declares `logger.serializers.req` against the raw HTTP request but
// calls it with the FastifyRequest (`request.log.info({ req: request })`), which
// is where `host` and `ip` come from. Accept the fields both shapes carry so the
// serializer satisfies the HTTP/1 `Fastify()` overload and still reads the
// Fastify-only properties when they are present.
export type LoggableRequest = Pick<IncomingMessage, 'method' | 'url' | 'headers'> & {
  host?: string
  ip?: string
  socket?: { remotePort?: number | undefined } | null
}

export function redactRequestLogUrl(url: string): string {
  const queryIndex = url.indexOf('?')
  return queryIndex === -1 ? url : `${url.slice(0, queryIndex)}${REDACTED_QUERY}`
}

export function serializeRequestForTechnicalLog(request: LoggableRequest): {
  method?: string
  url: string
  version?: string
  host?: string
  remoteAddress?: string
  remotePort?: number
} {
  const acceptVersion = request.headers['accept-version']
  return {
    method: request.method,
    url: redactRequestLogUrl(request.url ?? ''),
    version: Array.isArray(acceptVersion) ? acceptVersion.join(',') : acceptVersion,
    host: request.host,
    remoteAddress: request.ip,
    remotePort: request.socket?.remotePort
  }
}
