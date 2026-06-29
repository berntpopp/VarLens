import { describe, expect, test } from 'vitest'

import {
  isPlatformIdentityEnabled,
  readPlatformIdentityConfig
} from '../../src/web/server/platform-identity-config'

function baseEnv(): NodeJS.ProcessEnv {
  return {
    VARLENS_AUTH_MODE: 'platform',
    VARLENS_PLATFORM_ISSUER_URL: 'https://identity.example.test/realms/lb-map',
    VARLENS_PLATFORM_CLIENT_ID: 'varlens-dev',
    VARLENS_PLATFORM_AUDIENCE: 'lb-map:app:varlens:dev',
    VARLENS_PLATFORM_CALLBACK_PATH: '/auth/platform/callback',
    VARLENS_PLATFORM_REQUIRED_ACR: 'urn:lb-map:acr:password-plus-totp',
    VARLENS_PLATFORM_REQUIRED_AMR: 'pwd,otp',
    VARLENS_PLATFORM_ENTITLEMENTS_URL:
      'http://lb-map-operations.lb-map-operations-dev.svc.cluster.local/api/identity/entitlements/varlens/dev',
    VARLENS_PLATFORM_ENTITLEMENTS_TOKEN: 'opaque-token',
    VARLENS_PLATFORM_PROVISIONING_TOKEN: 'provisioning-token'
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
      issuerUrl: 'https://identity.example.test/realms/lb-map',
      clientId: 'varlens-dev',
      audience: 'lb-map:app:varlens:dev',
      callbackPath: '/auth/platform/callback',
      requiredAcr: 'urn:lb-map:acr:password-plus-totp',
      requiredAmr: ['pwd', 'otp'],
      entitlementsToken: 'opaque-token',
      provisioningToken: 'provisioning-token'
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
})
