import { describe, expect, test } from 'vitest'
import {
  redactRequestLogUrl,
  serializeRequestForTechnicalLog
} from '../../src/web/server/request-logging'

import fastify from 'fastify'

describe('web request technical logging', () => {
  test('redacts OIDC callback query credentials while retaining the route', () => {
    const loggedUrl = redactRequestLogUrl(
      '/auth/platform/callback?state=state-secret&code=code-secret&session_state=session-secret'
    )

    expect(loggedUrl).toBe('/auth/platform/callback?<redacted>')
    expect(loggedUrl).not.toContain('state-secret')
    expect(loggedUrl).not.toContain('code-secret')
    expect(loggedUrl).not.toContain('session-secret')
  })

  test('retains request metadata without logging any query values', () => {
    const loggedRequest = serializeRequestForTechnicalLog({
      method: 'GET',
      url: '/variants?caseId=case-secret',
      headers: { 'accept-version': '1' },
      host: 'varlens.example.test',
      ip: '203.0.113.5',
      socket: { remotePort: 41234 }
    })

    expect(loggedRequest).toEqual({
      method: 'GET',
      url: '/variants?<redacted>',
      version: '1',
      host: 'varlens.example.test',
      remoteAddress: '203.0.113.5',
      remotePort: 41234
    })
  })

  test('leaves routes without a query unchanged', () => {
    expect(redactRequestLogUrl('/health/ready')).toBe('/health/ready')
  })

  test('Fastify req serializer redacts query parameters in logged request events', async () => {
    const logs: string[] = []
    const destination = {
      write(chunk: string) {
        logs.push(chunk)
      }
    }
    const app = fastify({
      logger: {
        level: 'info',
        stream: destination,
        serializers: {
          req: serializeRequestForTechnicalLog
        }
      }
    })
    app.get('/test-route', async () => ({ status: 'ok' }))

    const response = await app.inject({
      method: 'GET',
      url: '/test-route?secret_token=super-secret-value&case_id=123'
    })
    expect(response.statusCode).toBe(200)
    await app.close()

    const combinedLogs = logs.join('')
    expect(combinedLogs).toContain('/test-route?<redacted>')
    expect(combinedLogs).not.toContain('super-secret-value')
    expect(combinedLogs).not.toContain('secret_token')
  })
})
