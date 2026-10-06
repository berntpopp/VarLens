import { describe, expect, test } from 'vitest'
import fastify from 'fastify'

import { registerPageGate } from '../../src/web/server/page-gate'
import { registerRobotsTxt } from '../../src/web/server/robots'

describe('web /robots.txt', () => {
  test('is public (no login redirect) and disallows all crawling', async () => {
    const app = fastify()
    try {
      registerPageGate(app, { appPathPrefix: '/varlens' })
      registerRobotsTxt(app)

      const response = await app.inject({ method: 'GET', url: '/robots.txt' })

      expect(response.statusCode, response.body).toBe(200)
      expect(response.headers.location).toBeUndefined()
      expect(response.headers['content-type']).toMatch(/^text\/plain/)
      expect(response.body).toMatch(/^User-agent: \*\nDisallow: \/\n$/)
    } finally {
      await app.close()
    }
  })
})
