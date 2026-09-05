import { describe, expect, test } from 'vitest'

import {
  isPlatformIdentityEnabled,
  readPlatformIdentityConfig
} from '../../src/web/server/platform-identity-config'

function baseEnv(): NodeJS.ProcessEnv {
  return {
    VARLENS_AUTH_MODE: 'platform',
    VARLENS_PLATFORM_ISSUER_URL: 'https://identity.example.test/realms/varlens-platform',
    VARLENS_PLATFORM_CLIENT_ID: 'varlens-dev',
    VARLENS_PLATFORM_AUDIENCE: 'varlens-platform:app:varlens:dev',
    VARLENS_PLATFORM_CALLBACK_PATH: '/auth/platform/callback',
    VARLENS_PLATFORM_REQUIRED_ACR: 'urn:varlens-platform:acr:password-plus-totp',
    VARLENS_PLATFORM_REQUIRED_AMR: 'pwd,otp',
    VARLENS_PLATFORM_ENTITLEMENTS_URL:
      'http://varlens-platform-operations.varlens-platform-operations-dev.svc.cluster.local/api/identity/entitlements/varlens/dev',
    VARLENS_PLATFORM_ENTITLEMENTS_TOKEN: `opaque-${'x'.repeat(40)}`
  }
}

describe('platform identity config', () => {
  test('defaults to local auth when VARLENS_AUTH_MODE is unset', () => {
    expect(readPlatformIdentityConfig({})).toBeNull()
    expect(isPlatformIdentityEnabled({})).toBe(false)
  })

  test('loads required platform auth values', () => {
    const config = readPlatformIdentityConfig(baseEnv())

    expect(config).toMatchObject({
      mode: 'platform',
      issuerUrl: 'https://identity.example.test/realms/varlens-platform',
      clientId: 'varlens-dev',
      audience: 'varlens-platform:app:varlens:dev',
      callbackPath: '/auth/platform/callback',
      requiredAcr: 'urn:varlens-platform:acr:password-plus-totp',
      requiredAmr: ['pwd', 'otp'],
      entitlementsToken: `opaque-${'x'.repeat(40)}`,
      verifyAccessToken: false
    })
  })

  test('fails loud when required platform values are missing', () => {
    expect(() => readPlatformIdentityConfig({ VARLENS_AUTH_MODE: 'platform' })).toThrow(
      /VARLENS_PLATFORM_ISSUER_URL/
    )
  })

  test('requires a safe callback path', () => {
    expect(() =>
      readPlatformIdentityConfig({
        ...baseEnv(),
        VARLENS_PLATFORM_CALLBACK_PATH: 'https://evil.example/callback'
      })
    ).toThrow(/CALLBACK_PATH/)
  })

  test('rejects a weak entitlements bearer token', () => {
    expect(() =>
      readPlatformIdentityConfig({
        ...baseEnv(),
        VARLENS_PLATFORM_ENTITLEMENTS_TOKEN: 'short-token'
      })
    ).toThrow(/at least 32 characters/i)
  })

  test('enables access-token JWT verification only when explicitly requested', () => {
    expect(
      readPlatformIdentityConfig({
        ...baseEnv(),
        VARLENS_PLATFORM_VERIFY_ACCESS_TOKEN: 'true'
      })
    ).toMatchObject({ verifyAccessToken: true })
  })
})
