/**
 * Public `/robots.txt`.
 *
 * VarLens web is a login-walled clinical workspace. Indexing is prevented
 * by the auth gate (every app page redirects anonymous clients to `/login`)
 * and by the login page's `noindex` meta, not by robots.txt: a robots
 * `Disallow: /` would hide that `noindex` from crawlers and fails
 * Lighthouse's crawlability audit on every authenticated page. Serving the
 * file explicitly (instead of letting the page gate 302 it to `/login`)
 * gives crawlers and audits a valid answer.
 */
import type { FastifyInstance } from 'fastify'

export const ROBOTS_TXT_PATH = '/robots.txt'

export const ROBOTS_TXT_BODY = 'User-agent: *\nAllow: /\n'

export function registerRobotsTxt(app: FastifyInstance): void {
  app.get(ROBOTS_TXT_PATH, { schema: { hide: true } }, async (_request, reply) => {
    reply.header('cache-control', 'public, max-age=86400')
    reply.type('text/plain; charset=utf-8')
    return ROBOTS_TXT_BODY
  })
}
