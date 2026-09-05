/**
 * Serves the standalone login page (`src/web/login/login.html`) at
 * `GET /login`. The page is plain HTML+CSS+vanilla-JS — no Vite, no
 * Vuetify, no SPA bundle — so an unauthenticated browser only ever
 * receives a single ~10 KB document. The Vue app stays hidden until a
 * valid session cookie is set.
 *
 * Rendered server-side per request: two placeholders are interpolated:
 *
 *   __APP_PATH_PREFIX__   Public URL prefix, e.g. `/varlens`. The page's
 *                         fetch() and post-login redirect must include it.
 *                         Sourced from the `APP_PATH_PREFIX` env and must
 *                         match the browser bundle's `VARLENS_WEB_BASE`.
 *   __REDIRECT_TO__       Where the browser navigates after a
 *                         successful login. Defaults to `<prefix>/`.
 *                         Honours an opaque `?next=` query parameter
 *                         set by the page gate, restricted to relative
 *                         same-prefix paths to prevent open redirects.
 *
 * Routes registered:
 *   GET /login             → login HTML (always public)
 *   GET /login/            → same (trailing slash)
 *
 * The `Cache-Control: no-store` header is deliberate: the page is
 * trivially small and should never be served stale (e.g. after the
 * APP_PATH_PREFIX env changes).
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import type { FastifyInstance } from 'fastify'

import { buildLoginPageRateLimitConfig } from './rate-limit'

const LOGIN_HTML_FILENAME = 'login.html'

export const DEFAULT_APP_PATH_PREFIX = '/varlens'
export const LOGIN_PAGE_CSP = [
  "default-src 'none'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "connect-src 'self'",
  "img-src 'self' data:",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'"
].join('; ')

/**
 * Resolve the URL prefix the SPA is mounted under. Reads `APP_PATH_PREFIX`
 * from the environment to match the renderer-build prefix convention.
 * Empty / unset → default `/varlens`.
 * A literal `/` means root mount and resolves to an empty prefix, so
 * concatenation (`prefix + '/'`, `prefix + '/api/...'`) stays unambiguous.
 * Otherwise the leading slash is enforced and the trailing slash is stripped.
 */
export function resolveAppPathPrefix(): string {
  const raw = process.env.APP_PATH_PREFIX
  const value = typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : DEFAULT_APP_PATH_PREFIX
  if (value === '/') return ''
  const withLeading = value.startsWith('/') ? value : '/' + value
  return withLeading.length > 1 && withLeading.endsWith('/')
    ? withLeading.slice(0, -1)
    : withLeading
}

/**
 * Validate a candidate post-login redirect target. Anything that is not
 * a relative same-prefix path is rejected to prevent open-redirect
 * abuse via a crafted `?next=https://evil.example/...`.
 */
export function sanitizeNextParam(next: unknown, appPathPrefix: string): string {
  const defaultTarget = appPathPrefix === '' ? '/' : appPathPrefix + '/'
  if (typeof next !== 'string' || next === '') return defaultTarget
  // Reject anything containing scheme, authority, backslashes, or
  // protocol-relative prefixes. Must start with a single `/` followed
  // by something other than `/` or `\`.
  if (!/^\/[^/\\]/.test(next)) return defaultTarget
  // Must remain inside the configured app prefix so we never bounce
  // the browser to an unrelated route on the same origin.
  if (appPathPrefix !== '' && next !== appPathPrefix && !next.startsWith(appPathPrefix + '/')) {
    return defaultTarget
  }
  return next
}

/**
 * Locate `login.html` on disk. At dev/test time the file lives next to
 * this source file under `src/web/login/`. At runtime in the bundled
 * server (esbuild → `out/web/server.cjs`) the file is copied to
 * `out/web/login/login.html` by the build step, so we resolve relative
 * to `__dirname`. An explicit override via `VARLENS_LOGIN_HTML_PATH`
 * exists for tests and for operators who want to ship a custom page.
 */
function resolveLoginHtmlPath(): string {
  const override = process.env.VARLENS_LOGIN_HTML_PATH
  if (typeof override === 'string' && override.trim() !== '') {
    return override.trim()
  }
  // Bundled layout: __dirname = out/web → out/web/login/login.html.
  // Source layout: __dirname = src/web/server → ../login/login.html.
  const bundled = resolve(__dirname, 'login', LOGIN_HTML_FILENAME)
  const source = resolve(__dirname, '..', 'login', LOGIN_HTML_FILENAME)
  // Lazy-pick the first existing path. We avoid statSync at module load
  // and only resolve when the route is hit, so a missing file fails
  // loudly with a useful error rather than a confusing crash on import.
  return process.env.VARLENS_WEB_BUNDLED === '0' ? source : bundled
}

let cachedTemplate: string | null = null
function loadTemplate(): string {
  if (cachedTemplate !== null) return cachedTemplate
  const path = resolveLoginHtmlPath()
  try {
    cachedTemplate = readFileSync(path, 'utf8')
    return cachedTemplate
  } catch {
    // Try the other layout before giving up — `out/web/login/...` vs
    // `src/web/login/...` differ by one directory and we'd rather
    // tolerate the ambiguity than force every entry-point to set an env.
    const alt = resolve(__dirname, '..', 'login', LOGIN_HTML_FILENAME)
    cachedTemplate = readFileSync(alt, 'utf8')
    return cachedTemplate
  }
}

function escapeForJsString(value: string): string {
  // The placeholders are embedded inside double-quoted JS string
  // literals in login.html; we only need to neutralise characters that
  // could break out of the literal or terminate the surrounding
  // </script> tag. Inputs come from env + a query param (sanitised
  // upstream to start with `/` and contain no scheme), so the surface
  // is small but worth pinning down here too.
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/</g, '\\u003c')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
}

export function renderLoginPage(appPathPrefix: string, redirectTo: string): string {
  const template = loadTemplate()
  return template
    .split('__APP_PATH_PREFIX__')
    .join(escapeForJsString(appPathPrefix))
    .split('__REDIRECT_TO__')
    .join(escapeForJsString(redirectTo))
}

export function registerLoginRoute(
  app: FastifyInstance,
  options: { platformAuthEnabled?: boolean } = {}
): void {
  const appPathPrefix = resolveAppPathPrefix()
  const loginPageRateLimit = buildLoginPageRateLimitConfig()
  const loginPageRateLimiter = app.rateLimit(loginPageRateLimit)

  const handler = async (
    request: { query: unknown },
    reply: {
      header: (k: string, v: string) => unknown
      code: (c: number) => unknown
      type: (t: string) => unknown
      send: (b: string) => unknown
    }
  ): Promise<unknown> => {
    const query = (request.query ?? {}) as Record<string, unknown>
    const redirectTo = sanitizeNextParam(query.next, appPathPrefix)
    if (options.platformAuthEnabled === true) {
      reply.header('cache-control', 'no-store')
      reply.code(302)
      reply.header(
        'location',
        `${appPathPrefix}/auth/platform/start?next=${encodeURIComponent(redirectTo)}`
      )
      return reply.send('')
    }
    const html = renderLoginPage(appPathPrefix, redirectTo)
    reply.header('cache-control', 'no-store')
    reply.header('content-security-policy', LOGIN_PAGE_CSP)
    reply.header('x-content-type-options', 'nosniff')
    reply.header('referrer-policy', 'same-origin')
    reply.type('text/html; charset=utf-8')
    return reply.send(html)
  }

  app.get(
    '/login',
    {
      schema: { hide: true },
      onRequest: [loginPageRateLimiter],
      config: { rateLimit: loginPageRateLimit }
    },
    handler
  )
  app.get(
    '/login/',
    {
      schema: { hide: true },
      onRequest: [loginPageRateLimiter],
      config: { rateLimit: loginPageRateLimit }
    },
    handler
  )
}
