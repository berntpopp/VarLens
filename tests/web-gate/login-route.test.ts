/**
 * Unit tests for `src/web/server/login-route.ts` — the helpers that
 * (a) resolve the app path prefix from env, (b) sanitise an attacker-
 * controllable `?next=` parameter against open-redirect attempts, and
 * (c) render the login page with placeholders interpolated.
 *
 * These run without a Postgres dependency, so they live outside
 * `tests/web-gate/integration/` and are part of the always-on web
 * gate suite.
 */
import { describe, expect, test, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'
import rateLimit from '@fastify/rate-limit'
import { resolve } from 'path'

import {
  DEFAULT_APP_PATH_PREFIX,
  LOGIN_PAGE_CSP,
  registerLoginRoute,
  renderLoginPage,
  resolveAppPathPrefix,
  sanitizeNextParam
} from '../../src/web/server/login-route'

const SOURCE_LOGIN_HTML = resolve(process.cwd(), 'src/web/login/login.html')

describe('renderLoginPage — first-load quality', () => {
  test('has a meta description and declares the app light color-scheme', () => {
    const html = renderLoginPage('/varlens', '/varlens/')
    expect(html).toMatch(/<meta\s+name="description"\s+content="[^"]{20,}"/)
    expect(html).toMatch(/<meta\s+name="color-scheme"\s+content="light"/)
    // The app ships no dark theme switch; the login wall must not go dark either.
    expect(html).not.toContain('prefers-color-scheme: dark')
  })

  test('hints the LCP logo with fetchpriority=high', () => {
    const html = renderLoginPage('/varlens', '/varlens/')
    expect(html).toMatch(/class="brand-logo"[\s\S]*?fetchpriority="high"/)
  })
})

describe('resolveAppPathPrefix', () => {
  const original = process.env.APP_PATH_PREFIX
  beforeEach(() => {
    delete process.env.APP_PATH_PREFIX
  })
  afterEach(() => {
    if (original === undefined) delete process.env.APP_PATH_PREFIX
    else process.env.APP_PATH_PREFIX = original
  })

  test('falls back to /varlens when env is unset', () => {
    expect(resolveAppPathPrefix()).toBe(DEFAULT_APP_PATH_PREFIX)
  })

  test('strips a trailing slash', () => {
    process.env.APP_PATH_PREFIX = '/workspace/'
    expect(resolveAppPathPrefix()).toBe('/workspace')
  })

  test('prepends a leading slash if missing', () => {
    process.env.APP_PATH_PREFIX = 'app'
    expect(resolveAppPathPrefix()).toBe('/app')
  })

  test('maps the bare / to a root mount prefix', () => {
    process.env.APP_PATH_PREFIX = '/'
    expect(resolveAppPathPrefix()).toBe('')
  })

  test('whitespace-only env reverts to default', () => {
    process.env.APP_PATH_PREFIX = '   '
    expect(resolveAppPathPrefix()).toBe(DEFAULT_APP_PATH_PREFIX)
  })
})

describe('sanitizeNextParam — open-redirect defence', () => {
  const prefix = '/varlens'

  test('non-string falls back to <prefix>/', () => {
    expect(sanitizeNextParam(undefined, prefix)).toBe(prefix + '/')
    expect(sanitizeNextParam(42, prefix)).toBe(prefix + '/')
    expect(sanitizeNextParam(null, prefix)).toBe(prefix + '/')
  })

  test('absolute URL with scheme is rejected', () => {
    expect(sanitizeNextParam('https://evil.example/', prefix)).toBe(prefix + '/')
    expect(sanitizeNextParam('http://evil.example/', prefix)).toBe(prefix + '/')
  })

  test('protocol-relative URL is rejected', () => {
    expect(sanitizeNextParam('//evil.example/', prefix)).toBe(prefix + '/')
  })

  test('backslash-prefixed (IE/Edge open-redirect quirk) is rejected', () => {
    expect(sanitizeNextParam('/\\evil.example', prefix)).toBe(prefix + '/')
  })

  test('relative path outside the configured prefix is rejected', () => {
    expect(sanitizeNextParam('/admin', prefix)).toBe(prefix + '/')
    expect(sanitizeNextParam('/varlensX/cases', prefix)).toBe(prefix + '/')
  })

  test('relative path inside the configured prefix is accepted as-is', () => {
    expect(sanitizeNextParam('/varlens/cases', prefix)).toBe('/varlens/cases')
    expect(sanitizeNextParam('/varlens/cases?id=42', prefix)).toBe('/varlens/cases?id=42')
  })

  test('exact match on the prefix itself is accepted', () => {
    expect(sanitizeNextParam('/varlens', prefix)).toBe('/varlens')
  })

  test('non-default prefix accepts paths inside it and rejects siblings', () => {
    expect(sanitizeNextParam('/workspace/cases', '/workspace')).toBe('/workspace/cases')
    expect(sanitizeNextParam('/workspace-tools/x', '/workspace')).toBe('/workspace/')
  })

  test('root mount accepts safe relative paths', () => {
    expect(sanitizeNextParam('/cases', '')).toBe('/cases')
    expect(sanitizeNextParam(undefined, '')).toBe('/')
    expect(sanitizeNextParam('//evil.example/', '')).toBe('/')
  })
})

describe('renderLoginPage — placeholder interpolation', () => {
  test('replaces both placeholders without leaking JS', () => {
    const html = renderLoginPage('/varlens', '/varlens/cases?id=1')
    expect(html).not.toContain('__APP_PATH_PREFIX__')
    expect(html).not.toContain('__REDIRECT_TO__')
    expect(html).toMatch(/var APP_PATH_PREFIX = ['"]\/varlens['"]/)
    expect(html).toMatch(/var REDIRECT_TO = ['"]\/varlens\/cases\?id=1['"]/)
  })

  test('escapes embedded </script> sequences in the redirect target', () => {
    // The redirect is sanitised upstream so this string would never
    // actually reach renderLoginPage, but defence-in-depth: even if it
    // did, the rendered page must not break out of the script literal.
    const html = renderLoginPage('/varlens', '/varlens</script><script>alert(1)//')
    expect(html).not.toMatch(/<\/script><script>alert/i)
    // Escaping `<` is sufficient to prevent the breakout — `</script>`
    // becomes `</script>`, which the HTML parser no longer treats
    // as a script-end token.
    expect(html).toContain('\\u003c/script>')
  })

  test('escapes embedded double quotes', () => {
    const html = renderLoginPage('/varlens', '/varlens"; window.location="evil')
    expect(html).not.toContain('window.location="evil')
    expect(html).toContain('\\"')
  })
})

describe('login page CSP', () => {
  test('allows only the standalone login page surface', () => {
    expect(LOGIN_PAGE_CSP).toContain("default-src 'none'")
    expect(LOGIN_PAGE_CSP).toContain("connect-src 'self'")
    expect(LOGIN_PAGE_CSP).toContain("frame-ancestors 'none'")
  })
})

describe('login page rate limiting', () => {
  test('limits /login and /login/ as one public-page group', async () => {
    const previousHtmlPath = process.env.VARLENS_LOGIN_HTML_PATH
    const previousMax = process.env.VARLENS_LOGIN_PAGE_RATE_LIMIT_MAX
    process.env.VARLENS_LOGIN_HTML_PATH = SOURCE_LOGIN_HTML
    process.env.VARLENS_LOGIN_PAGE_RATE_LIMIT_MAX = '2'

    const app = Fastify({ logger: false })
    try {
      await app.register(rateLimit, { global: false })
      registerLoginRoute(app)

      expect((await app.inject({ method: 'GET', url: '/login' })).statusCode).toBe(200)
      expect((await app.inject({ method: 'GET', url: '/login/' })).statusCode).toBe(200)
      expect((await app.inject({ method: 'GET', url: '/login' })).statusCode).toBe(429)
    } finally {
      await app.close()
      if (previousHtmlPath === undefined) delete process.env.VARLENS_LOGIN_HTML_PATH
      else process.env.VARLENS_LOGIN_HTML_PATH = previousHtmlPath
      if (previousMax === undefined) delete process.env.VARLENS_LOGIN_PAGE_RATE_LIMIT_MAX
      else process.env.VARLENS_LOGIN_PAGE_RATE_LIMIT_MAX = previousMax
    }
  })
})
