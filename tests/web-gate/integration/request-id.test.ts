import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, test } from 'vitest'

/**
 * C3 — the web server must not adopt the client-supplied x-request-id. It is a
 * spoofable, collidable, unbounded log-injection vector on a directly reachable
 * endpoint. The server generates a random UUID per request instead.
 */
const isWebBuilt = existsSync(resolve(process.cwd(), 'out/web/server.cjs'))
const HAS_PG = typeof process.env.VARLENS_PG_URL === 'string' && process.env.VARLENS_PG_URL !== ''
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

describe.skipIf(!isWebBuilt || !HAS_PG)(
  'C3: request id is server-generated, not client-trusted',
  () => {
    test('ignores a spoofed/oversized client x-request-id and returns a fresh UUID per request', async () => {
      const { buildApp } = await import('../../../src/web/server')
      const app = await buildApp()
      try {
        const spoofed = 'x'.repeat(10_000)
        const first = await app.inject({
          method: 'GET',
          url: '/livez',
          headers: { 'x-request-id': spoofed }
        })
        const firstId = first.headers['x-request-id']
        expect(typeof firstId).toBe('string')
        expect(firstId).not.toBe(spoofed)
        expect(firstId).toMatch(UUID_RE)

        const second = await app.inject({ method: 'GET', url: '/livez' })
        const secondId = second.headers['x-request-id']
        expect(secondId).toMatch(UUID_RE)
        expect(secondId).not.toBe(firstId)
      } finally {
        await app.close()
      }
    })
  }
)
