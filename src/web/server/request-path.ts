/**
 * The request path as Fastify's router matched it (#506).
 *
 * The gates used to test the raw `request.url`, but the router (find-my-way,
 * `Router.prototype.find`) first strips an absolute-form `http://host`, cuts at
 * `?` or `#`, and percent-decodes once — so `/%61pi/x` reached `/api/:domain/:method`
 * while every `startsWith('/api/')` gate looked away. This mirrors those steps;
 * the route check below then makes a disagreement in the dangerous direction
 * (an `/api/` route matched, a non-API path computed) a 400 rather than a bypass.
 */
import type { FastifyRequest } from 'fastify'

const ABSOLUTE_FORM_PREFIX = /^https?:\/\/.*?\//

function badRequestPath(): Error {
  return Object.assign(new Error('malformed request path'), { statusCode: 400 })
}

export function requestPath(request: FastifyRequest): string {
  const raw = request.url
  const target = raw.startsWith('/') ? raw : raw.replace(ABSOLUTE_FORM_PREFIX, '/')
  let path: string
  try {
    path = decodeURI(target.split(/[?#]/, 1)[0])
  } catch {
    throw badRequestPath()
  }
  if (request.routeOptions.url?.startsWith('/api/') === true && !path.startsWith('/api/')) {
    throw badRequestPath()
  }
  return path
}
