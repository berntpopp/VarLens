import { describe, expect, test } from 'vitest'
import {
  redactRequestLogUrl,
  serializeRequestForTechnicalLog
} from '../../src/web/server/request-logging'

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
})
