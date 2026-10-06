/**
 * Public `/robots.txt`.
 *
 * VarLens web is a login-walled clinical workspace; nothing should be
 * indexed. Serving this file explicitly (instead of letting the page gate
 * 302 crawlers to `/login`) gives crawlers and audits a valid, unambiguous
 * "disallow everything" answer.
 */
import type { FastifyInstance } from 'fastify'

export const ROBOTS_TXT_PATH = '/robots.txt'

export const ROBOTS_TXT_BODY = 'User-agent: *\nDisallow: /\n'

export function registerRobotsTxt(app: FastifyInstance): void {
  app.get(ROBOTS_TXT_PATH, { schema: { hide: true } }, async (_request, reply) => {
    reply.header('cache-control', 'public, max-age=86400')
    reply.type('text/plain; charset=utf-8')
    return ROBOTS_TXT_BODY
  })
}
