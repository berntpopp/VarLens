import { describe, expect, test } from 'vitest'

import {
  isPlatformIdentityEnabled,
  readPlatformIdentityConfig
} from '../../src/web/server/platform-identity-config'

const STRONG_ENTITLEMENTS_TOKEN = 'introspection-token-that-is-at-least-32ch'
const STRONG_PROVISIONING_TOKEN = 'provisioning-token-that-is-at-least-32chr'

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
    VARLENS_PLATFORM_ENTITLEMENTS_TOKEN: STRONG_ENTITLEMENTS_TOKEN,
    VARLENS_PLATFORM_PROVISIONING_TOKEN: STRONG_PROVISIONING_TOKEN
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
      entitlementsToken: STRONG_ENTITLEMENTS_TOKEN,
      provisioningToken: STRONG_PROVISIONING_TOKEN
    })
  })

  test('rejects a provisioning token weaker than 32 characters', () => {
    expect(() =>
      readPlatformIdentityConfig({
        ...baseEnv(),
        VARLENS_PLATFORM_PROVISIONING_TOKEN: 'x'
      })
    ).toThrow(/at least 32/)
  })

  test('rejects an entitlements token weaker than 32 characters', () => {
    expect(() =>
      readPlatformIdentityConfig({
        ...baseEnv(),
        VARLENS_PLATFORM_ENTITLEMENTS_TOKEN: 'short-token'
      })
    ).toThrow(/at least 32/)
  })

  test('rejects a hex-encoded token that decodes to fewer than 32 bytes', () => {
    // 32 hex chars = 16 bytes; the session-secret floor is 32 bytes.
    expect(() =>
      readPlatformIdentityConfig({
        ...baseEnv(),
        VARLENS_PLATFORM_PROVISIONING_TOKEN: 'a'.repeat(32)
      })
    ).toThrow(/at least 32/)
  })

  test('accepts a 64-char hex token (32 bytes)', () => {
    const config = readPlatformIdentityConfig({
      ...baseEnv(),
      VARLENS_PLATFORM_PROVISIONING_TOKEN: 'a'.repeat(64)
    })
    expect(config?.provisioningToken).toBe('a'.repeat(64))
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
