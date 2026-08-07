import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, test } from 'vitest'

const isWebBuilt = existsSync(resolve(process.cwd(), 'out/web/server.cjs'))
const hasPostgres =
  typeof process.env.VARLENS_PG_URL === 'string' && process.env.VARLENS_PG_URL !== ''
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

describe.skipIf(!isWebBuilt || !hasPostgres)('web request IDs', () => {
  test('generates a fresh UUID instead of trusting a client-supplied request ID', async () => {
    const { buildApp } = await import('../../../src/web/server')
    const app = await buildApp()
    try {
      const spoofed = 'x'.repeat(10_000)
      const first = await app.inject({
        method: 'GET',
        url: '/healthz',
        headers: { 'x-request-id': spoofed }
      })
      const firstId = first.headers['x-request-id']
      expect(firstId).not.toBe(spoofed)
      expect(firstId).toMatch(UUID_RE)

      const second = await app.inject({ method: 'GET', url: '/healthz' })
      expect(second.headers['x-request-id']).toMatch(UUID_RE)
      expect(second.headers['x-request-id']).not.toBe(firstId)
    } finally {
      await app.close()
    }
  })
})
