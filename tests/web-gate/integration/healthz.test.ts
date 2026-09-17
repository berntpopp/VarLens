import { describe, expect, test, vi } from 'vitest'
import pg from 'pg'
import { existsSync } from 'fs'
import { resolve } from 'path'

/**
 * Phase 2: `/healthz` returns 200 with `{ status, version, db }` on a
 * healthy server. The boot path is fail-loud — buildApp rejects when
 * VARLENS_PG_URL is missing or the configured Postgres is unreachable.
 *
 * Gated on (a) the web build existing AND (b) VARLENS_PG_URL being set.
 * Without VARLENS_PG_URL the new postgres-required.test.ts covers the
 * abort-without-pg behaviour. Without out/web/server.cjs (no `make
 * build`) we skip to keep dev iteration fast.
 */

const WEB_BUILD_PATH = resolve(process.cwd(), 'out/web/server.cjs')
const isWebBuilt = existsSync(WEB_BUILD_PATH)
const HAS_PG = typeof process.env.VARLENS_PG_URL === 'string' && process.env.VARLENS_PG_URL !== ''

describe.skipIf(!isWebBuilt || !HAS_PG)('healthz integration', () => {
  test('DB failure affects readiness but not liveness, and readiness recovers', async () => {
    const { buildApp } = await import('../../../src/web/server')
    const app = await buildApp()
    const query = vi.spyOn(pg.Pool.prototype, 'query')
    try {
      query.mockRejectedValue(new Error('simulated PostgreSQL outage'))
      const live = await app.inject({ method: 'GET', url: '/livez' })
      expect(live.statusCode).toBe(200)
      expect(query).not.toHaveBeenCalled()

      for (const url of ['/readyz', '/healthz']) {
        const response = await app.inject({ method: 'GET', url })
        expect(response.statusCode).toBe(503)
        expect(response.json()).toMatchObject({ status: 'unhealthy', db: { open: false } })
      }
      expect(query).toHaveBeenCalledTimes(2)

      query.mockRestore()
      for (const url of ['/readyz', '/healthz']) {
        const response = await app.inject({ method: 'GET', url })
        expect(response.statusCode).toBe(200)
        expect(response.json()).toMatchObject({ status: 'ok', db: { open: true } })
      }
    } finally {
      query.mockRestore()
      await app.close()
    }
  })

  test('GET /healthz returns 200 with status payload when Postgres is open', async () => {
    const { buildApp } = await import('../../../src/web/server')
    const app = await buildApp()
    try {
      const res = await app.inject({ method: 'GET', url: '/healthz' })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body).toMatchObject({
        status: 'ok',
        version: expect.any(String),
        db: expect.objectContaining({ open: true })
      })
    } finally {
      await app.close()
    }
  })
})
