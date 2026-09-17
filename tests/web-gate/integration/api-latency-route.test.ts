import { describe, expect, test } from 'vitest'

import { SAME_ORIGIN_HEADERS, startIsolatedWebSchema } from '../helpers/web-driver'

const HAS_PG = typeof process.env.VARLENS_PG_URL === 'string' && process.env.VARLENS_PG_URL !== ''

describe.skipIf(!HAS_PG)('web dev API latency route', () => {
  let nodeEnvBeforeLatencyTest: string | undefined

  test('delays real /api dispatcher calls in development only', async () => {
    const isolated = await startIsolatedWebSchema('api_latency_route')
    const previousLatency = process.env.VARLENS_WEB_API_LATENCY_MS
    const previousNodeEnv = process.env.NODE_ENV
    nodeEnvBeforeLatencyTest = process.env.NODE_ENV
    try {
      process.env.NODE_ENV = 'development'
      process.env.VARLENS_WEB_API_LATENCY_MS = '120'

      const { buildApp } = await import('../../../src/web/server')
      const app = await buildApp()
      try {
        const started = performance.now()
        const res = await app.inject({
          method: 'POST',
          url: '/api/auth/isAccountsEnabled',
          payload: { args: [] },
          headers: SAME_ORIGIN_HEADERS
        })
        const elapsedMs = performance.now() - started

        expect(res.statusCode, res.body).toBe(200)
        expect(elapsedMs).toBeGreaterThanOrEqual(100)
      } finally {
        await app.close()
      }
    } finally {
      if (previousLatency === undefined) delete process.env.VARLENS_WEB_API_LATENCY_MS
      else process.env.VARLENS_WEB_API_LATENCY_MS = previousLatency
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = previousNodeEnv
      await isolated.close()
    }
  })

  test('restores NODE_ENV after enabling development latency', () => {
    expect(process.env.NODE_ENV).toBe(nodeEnvBeforeLatencyTest)
  })
})
