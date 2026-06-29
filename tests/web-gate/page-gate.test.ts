import { describe, expect, test } from 'vitest'
import fastify from 'fastify'

import { registerPageGate } from '../../src/web/server/page-gate'

describe('web page gate', () => {
  test('treats probe paths as public in the fast static gate', async () => {
    const app = fastify()
    try {
      registerPageGate(app, { appPathPrefix: '/varlens' })
      app.setNotFoundHandler(async (_request, reply) => {
        reply.type('application/json')
        return { passthrough: true }
      })

      for (const url of ['/livez', '/readyz', '/healthz']) {
        const response = await app.inject({ method: 'GET', url })
        expect(response.statusCode, url).toBe(200)
        expect(response.headers.location, url).toBeUndefined()
        expect(response.json(), url).toEqual({ passthrough: true })
      }
    } finally {
      await app.close()
    }
  })

  test('does not treat arbitrary /login/* paths as public', async () => {
    const app = fastify()
    try {
      registerPageGate(app, { appPathPrefix: '/varlens' })
      app.setNotFoundHandler(async (_request, reply) => {
        reply.type('text/html')
        return '<html><body>SPA shell</body></html>'
      })

      const response = await app.inject({ method: 'GET', url: '/login/anything' })

      expect(response.statusCode, response.body).toBe(302)
      expect(response.headers.location).toMatch(/^\/varlens\/login\?next=/)
      expect(response.body).not.toContain('SPA shell')
    } finally {
      await app.close()
    }
  })

  test('redirects anonymous shell requests to platform auth start when configured', async () => {
    const app = fastify()
    try {
      registerPageGate(app, { appPathPrefix: '/varlens', loginPath: '/auth/platform/start' })
      app.setNotFoundHandler(async (_request, reply) => {
        reply.type('text/html')
        return '<html><body>SPA shell</body></html>'
      })

      const response = await app.inject({ method: 'GET', url: '/cases?case=1' })

      expect(response.statusCode, response.body).toBe(302)
      expect(response.headers.location).toBe(
        '/varlens/auth/platform/start?next=%2Fvarlens%2Fcases%3Fcase%3D1'
      )
    } finally {
      await app.close()
    }
  })

  test('allows the configured platform callback path through anonymously', async () => {
    const app = fastify()
    try {
      registerPageGate(app, {
        appPathPrefix: '/varlens',
        loginPath: '/auth/platform/start',
        platformCallbackPath: '/oidc/callback'
      })
      app.get('/oidc/callback', async () => ({ callback: true }))

      const response = await app.inject({ method: 'GET', url: '/oidc/callback?code=1' })

      expect(response.statusCode, response.body).toBe(200)
      expect(response.json()).toEqual({ callback: true })
    } finally {
      await app.close()
    }
  })

  test('redirects stale local sessions when platform auth is required', async () => {
    const app = fastify()
    const deleted = { value: false }
    try {
      app.addHook('preHandler', async (request) => {
        ;(request as typeof request & { session: unknown }).session = {
          user: {
            id: 1,
            username: 'alice',
            role: 'user',
            passwordChangedAt: '2026-01-01T00:00:00.000Z'
          },
          authMode: 'local',
          delete: () => {
            deleted.value = true
          }
        }
      })
      registerPageGate(app, {
        appPathPrefix: '/varlens',
        loginPath: '/auth/platform/start',
        requirePlatformAuth: true
      })
      app.setNotFoundHandler(async (_request, reply) => {
        reply.type('text/html')
        return '<html><body>SPA shell</body></html>'
      })

      const response = await app.inject({ method: 'GET', url: '/cases' })

      expect(response.statusCode, response.body).toBe(302)
      expect(response.headers.location).toBe('/varlens/auth/platform/start?next=%2Fvarlens%2Fcases')
      expect(response.body).not.toContain('SPA shell')
      expect(deleted.value).toBe(true)
    } finally {
      await app.close()
    }
  })
})
