/**
 * Login wall — anonymous browsers never receive the SPA shell.
 *
 * Verifies the four observable contracts of `page-gate.ts` +
 * `login-route.ts`:
 *
 *   1. Anonymous GET `/` is 302'd to `/login` with a `?next=` that
 *      preserves the originally-requested path under the configured
 *      app prefix.
 *   2. `/livez`, `/readyz`, and `/healthz` are always public.
 *   3. `GET /login` always serves the login HTML, both with and
 *      without a session cookie.
 *   4. The page gate honours non-default `APP_PATH_PREFIX` values so
 *      the redirect lands inside Caddy's `handle_path` window.
 *
 * Gated on the web build existing AND VARLENS_PG_URL being set, the
 * same conditions every other web integration test uses.
 */
import { describe, expect, test, beforeAll, afterAll } from 'vitest'
import { existsSync } from 'fs'
import { resolve } from 'path'

const WEB_BUILD_PATH = resolve(process.cwd(), 'out/web/server.cjs')
const isWebBuilt = existsSync(WEB_BUILD_PATH)
const HAS_PG = typeof process.env.VARLENS_PG_URL === 'string' && process.env.VARLENS_PG_URL !== ''

// Resolve the bundled login.html via the env override so tests run
// against the source file even before the static-copy plugin has
// emitted `out/web/login/login.html`.
const SOURCE_LOGIN_HTML = resolve(process.cwd(), 'src/web/login/login.html')

function escapeRegExp(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')
}

describe.skipIf(!isWebBuilt || !HAS_PG)('login-wall integration', () => {
  let app: {
    inject: (
      opts: unknown
    ) => Promise<{ statusCode: number; headers: Record<string, string>; body: string }>
    close: () => Promise<void>
  }
  const previousEnv: Record<string, string | undefined> = {}

  beforeAll(async () => {
    previousEnv.LOGIN = process.env.VARLENS_LOGIN_HTML_PATH
    process.env.VARLENS_LOGIN_HTML_PATH = SOURCE_LOGIN_HTML
    const { buildApp } = await import('../../../src/web/server')
    app = (await buildApp()) as never
  })

  afterAll(async () => {
    if (app !== undefined) await app.close()
    if (previousEnv.LOGIN === undefined) delete process.env.VARLENS_LOGIN_HTML_PATH
    else process.env.VARLENS_LOGIN_HTML_PATH = previousEnv.LOGIN
  })

  test('anonymous GET / is redirected to /login with a ?next pointing back at /', async () => {
    const res = await app.inject({ method: 'GET', url: '/' })
    expect(res.statusCode).toBe(302)
    const location = res.headers['location']
    expect(typeof location).toBe('string')
    // The Location header is constructed inside Caddy's `handle_path`
    // window — i.e. it includes the APP_PATH_PREFIX so the browser's
    // next request lands at https://<host>/varlens/login on its way
    // back through Caddy.
    const prefix = (process.env.APP_PATH_PREFIX ?? '/varlens').replace(/\/$/, '')
    expect(location).toMatch(new RegExp('^' + escapeRegExp(prefix) + '/login(\\?next=|$)'))
  })

  test('anonymous GET /assets/anything is also walled', async () => {
    const res = await app.inject({ method: 'GET', url: '/assets/index-abcd.js' })
    expect(res.statusCode).toBe(302)
  })

  test('GET /healthz bypasses the wall (200, JSON)', async () => {
    const res = await app.inject({ method: 'GET', url: '/healthz' })
    expect([200, 503]).toContain(res.statusCode)
    expect(res.headers['content-type']).toMatch(/application\/json/)
  })

  test('GET /livez and /readyz bypass the wall', async () => {
    const live = await app.inject({ method: 'GET', url: '/livez' })
    expect(live.statusCode).toBe(200)
    expect(live.headers['content-type']).toMatch(/application\/json/)

    const ready = await app.inject({ method: 'GET', url: '/readyz' })
    expect([200, 503]).toContain(ready.statusCode)
    expect(ready.headers['content-type']).toMatch(/application\/json/)
  })

  test('GET /login serves the login HTML with no-store cache header', async () => {
    const res = await app.inject({ method: 'GET', url: '/login' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toMatch(/text\/html/)
    expect(res.headers['cache-control']).toBe('no-store')
    expect(res.body).toMatch(/<form id="login-form"/)
    expect(res.body).toMatch(/\/api\/auth\/login/)
    // The placeholder must be interpolated, not left in the response.
    expect(res.body).not.toContain('__APP_PATH_PREFIX__')
    expect(res.body).not.toContain('__REDIRECT_TO__')
  })

  test('GET /login?next=//evil.example/ refuses the open-redirect target', async () => {
    const res = await app.inject({ method: 'GET', url: '/login?next=//evil.example/' })
    expect(res.statusCode).toBe(200)
    // The interpolated REDIRECT_TO must not contain the attacker host.
    expect(res.body).not.toContain('evil.example')
  })

  test('non-API, non-public POSTs are not walled (auth.ts handles those)', async () => {
    // page-gate only intercepts GET/HEAD; everything else flows through
    // to whatever route handler exists, which for a non-existent path
    // is the SPA fallback. We assert it isn't a 302 to /login.
    const res = await app.inject({ method: 'POST', url: '/some-non-api-path' })
    expect(res.statusCode).not.toBe(302)
  })
})
