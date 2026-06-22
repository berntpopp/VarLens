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
})
