/**
 * Server-side login wall.
 *
 * `auth.ts` already gates `/api/*` paths. This module gates everything
 * else: the SPA shell (`/`, `/index.html`), JS/CSS chunks, fonts,
 * favicon, etc. An unauthenticated browser hitting any of those is
 * redirected to `/login` and never receives a single SPA byte. A
 * successful login binds the session cookie and the next request lands
 * on the SPA, fully unaware that auth ever happened.
 *
 * Decision matrix per request:
 *
 *                          | session.user present | absent
 *   ──────────────────────────────────────────────────────────────
 *   /api/*                 | passthrough          | auth.ts handles 401
 *   /livez, /readyz,
 *   /healthz               | passthrough          | passthrough  (health probes)
 *   /login, /login/,
 *   /auth/platform/*       | passthrough          | passthrough  (the wall itself)
 *   non-GET                | passthrough          | passthrough  (auth.ts/CSRF surface)
 *   anything else (GET)    | passthrough          | 302 → /login?next=<path>
 *
 * Why preHandler and not onRequest: `@fastify/secure-session` populates
 * `request.session` in its preValidation/preHandler chain, and we need
 * to read `request.session.user` here. preHandler runs after that, so
 * the session object is ready by the time we look.
 *
 * Open-redirect defence: only the request's path+query is considered
 * for `?next=`. Anything containing `\` or matching `//host` shape is
 * dropped (defence in depth — `sanitizeNextParam` in login-route.ts is
 * the second checkpoint).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

const ALWAYS_PUBLIC_PATHS = new Set<string>([
  '/livez',
  '/readyz',
  '/healthz',
  '/login',
  '/login/',
  '/auth/platform/start',
  '/auth/platform/callback'
])

/**
 * Root-level brand/icon assets that must load for an unauthenticated browser
 * (the login tab's favicon, PWA manifest + icons). They are non-sensitive —
 * the public logo — so they bypass the login wall like `/healthz`.
 */
const PUBLIC_ROOT_ASSETS = new Set<string>([
  '/favicon.ico',
  '/favicon.svg',
  '/apple-touch-icon.png',
  '/manifest.webmanifest',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-maskable-512.png'
])

/**
 * Build the `?next=` value for the post-login redirect. Returns an
 * empty string when the request path isn't a safe relative path; the
 * login route then falls back to the configured app prefix.
 */
function buildNextParam(rawUrl: string): string {
  // Drop anything that already smells like an open-redirect attempt.
  // The browser never sends scheme+authority on a same-origin GET, so
  // a `\` or `//` anywhere in the URL is suspicious.
  if (rawUrl === '' || rawUrl[0] !== '/') return ''
  if (rawUrl.includes('\\')) return ''
  if (rawUrl.startsWith('//')) return ''
  // Cap absurdly long URLs — the login route re-validates the prefix
  // anyway, this is just to keep the redirect Location header sane.
  if (rawUrl.length > 2048) return ''
  return rawUrl
}

export interface PageGateOptions {
  /**
   * Browser-visible prefix the SPA lives under. Used to construct the
   * `Location` header for the 302. Defaults are resolved by login-route.ts.
   */
  appPathPrefix: string
  loginPath?: string
  platformCallbackPath?: string
  requirePlatformAuth?: boolean
}

export function registerPageGate(app: FastifyInstance, options: PageGateOptions): void {
  const { appPathPrefix } = options
  const loginPath = options.loginPath ?? '/login'
  const publicPaths = new Set(ALWAYS_PUBLIC_PATHS)
  if (options.platformCallbackPath !== undefined) {
    publicPaths.add(options.platformCallbackPath)
  }

  app.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    // Only intercept GETs. POST/PUT/DELETE traffic is API-only and is
    // handled by auth.ts (401 for unauthenticated `/api/*`).
    if (request.method !== 'GET' && request.method !== 'HEAD') return

    const fullUrl = request.url
    const path = fullUrl.split('?', 1)[0]

    // `/api/*` is auth.ts's territory — never short-circuit it here, or
    // the API would start redirecting instead of returning JSON 401s.
    if (path.startsWith('/api/')) return
    if (publicPaths.has(path) || PUBLIC_ROOT_ASSETS.has(path)) return

    // Build the redirect target, prepending the app prefix because a
    // prefix-stripping proxy forwards `/login` to Fastify while the
    // browser still sees e.g. `/varlens/login`.
    const next = buildNextParam(fullUrl)
    const location =
      appPathPrefix +
      loginPath +
      (next !== '' ? '?next=' + encodeURIComponent(appPathPrefix + next) : '')

    const user = request.session?.user
    if (user !== undefined) {
      if (options.requirePlatformAuth === true && request.session.authMode !== 'platform') {
        request.session.delete()
      } else {
        return
      }
    }

    reply.header('cache-control', 'no-store')
    reply.code(302)
    reply.header('location', location)
    return reply.send()
  })
}
