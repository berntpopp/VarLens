import { describe, expect, test } from 'vitest'

import {
  isAllowedApiOrigin,
  isAllowedUnsafeApiRequest,
  isPublicApiPath
} from '../../src/web/server/auth'

describe('web auth origin gate', () => {
  test('API docs require a session unless the operator makes them public (P-21)', () => {
    for (const path of ['/api/docs', '/api/docs/', '/api/openapi.json']) {
      expect(isPublicApiPath(path, {})).toBe(false)
    }
    expect(isPublicApiPath('/api/auth/login', {})).toBe(true)
  })

  test('treats the Swagger UI entry route and nested assets as public when opted in', () => {
    const env = { VARLENS_WEB_PUBLIC_API_DOCS: '1' }
    expect(isPublicApiPath('/api/docs', env)).toBe(true)
    expect(isPublicApiPath('/api/docs/', env)).toBe(true)
    expect(isPublicApiPath('/api/docs/static/swagger-initializer.js', env)).toBe(true)
    expect(isPublicApiPath('/api/openapi.json', env)).toBe(true)
    expect(isPublicApiPath('/api/docs-evil', env)).toBe(false)
  })

  test('rejects missing Origin for unsafe API requests', () => {
    expect(
      isAllowedApiOrigin({
        origin: undefined,
        host: 'varlens.example',
        protocol: 'https'
      })
    ).toBe(false)
  })

  test('allows same-origin API requests', () => {
    expect(
      isAllowedApiOrigin({
        origin: 'https://varlens.example',
        host: 'varlens.example',
        protocol: 'https'
      })
    ).toBe(true)
  })

  test('rejects cross-origin and protocol-downgrade API requests', () => {
    expect(
      isAllowedApiOrigin({
        origin: 'https://evil.example',
        host: 'varlens.example',
        protocol: 'https'
      })
    ).toBe(false)
    expect(
      isAllowedApiOrigin({
        origin: 'http://varlens.example',
        host: 'varlens.example',
        protocol: 'https'
      })
    ).toBe(false)
  })

  test('allows unsafe API requests with same-origin or same-site Fetch Metadata', () => {
    for (const secFetchSite of ['same-origin', 'same-site']) {
      expect(
        isAllowedUnsafeApiRequest({
          secFetchSite,
          origin: undefined,
          host: 'varlens.example',
          protocol: 'https'
        })
      ).toBe(true)
    }
  })

  test('rejects unsafe API requests with cross-site or none Fetch Metadata', () => {
    for (const secFetchSite of ['cross-site', 'none']) {
      expect(
        isAllowedUnsafeApiRequest({
          secFetchSite,
          origin: 'https://varlens.example',
          host: 'varlens.example',
          protocol: 'https'
        })
      ).toBe(false)
    }
  })

  test('falls back to strict Origin verification when Fetch Metadata is absent', () => {
    expect(
      isAllowedUnsafeApiRequest({
        secFetchSite: undefined,
        origin: 'https://varlens.example',
        host: 'varlens.example',
        protocol: 'https'
      })
    ).toBe(true)

    expect(
      isAllowedUnsafeApiRequest({
        secFetchSite: undefined,
        origin: 'https://evil.example',
        host: 'varlens.example',
        protocol: 'https'
      })
    ).toBe(false)
  })

  test('rejects unsafe API requests when Fetch Metadata and Origin are both absent', () => {
    expect(
      isAllowedUnsafeApiRequest({
        secFetchSite: undefined,
        origin: undefined,
        host: 'varlens.example',
        protocol: 'https'
      })
    ).toBe(false)
  })
})
