import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Stats } from 'fs'

vi.mock('@electron-toolkit/utils', () => ({ is: { dev: false } }))
vi.mock('electron', () => ({ app: { isPackaged: true, getPath: () => '' } }))

import {
  getAccessGate,
  passThroughProvider,
  setAccessProvider
} from '../../../src/main/auth/access-gate'
import { getDesktopAuth, installDesktopAuth } from '../../../src/main/auth/desktop-auth'
import type { ConfigSource, DesktopAuthConfig } from '../../../src/main/auth/desktop-auth-config'
import { PlatformAccessProvider } from '../../../src/main/auth/platform-access-provider'
import type { DatabaseManager } from '../../../src/main/services/DatabaseManager'

const CONFIG: DesktopAuthConfig = {
  issuer: 'https://keycloak.example.org/realms/varlens',
  clientId: 'varlens-desktop',
  audience: 'varlens-desktop',
  requiredAcr: 'urn:varlens:acr:password-plus-totp',
  requiredAmr: ['pwd', 'otp'],
  access: { claim: 'groups', value: '/varlens-desktop' },
  idleLockMinutes: 15,
  maxSessionMinutes: 480,
  requirePassphrase: false
}
const PLATFORM = JSON.stringify({ mode: 'platform', ...CONFIG })

function entry(kind: 'file' | 'folder'): Stats {
  return {
    uid: 0,
    mode: kind === 'file' ? 0o644 : 0o755,
    isFile: () => kind === 'file',
    isDirectory: () => kind === 'folder',
    isSymbolicLink: () => false
  } as Stats
}

function sourceWith(text: string | undefined): ConfigSource {
  const files: Record<string, Stats> =
    text === undefined
      ? {}
      : { '/etc/varlens/auth.json': entry('file'), '/etc/varlens': entry('folder') }
  return {
    platform: 'linux',
    env: {},
    development: false,
    fs: {
      probe: (path) =>
        files[path] === undefined ? { state: 'absent' } : { state: 'present', stats: files[path] },
      readFile: () => text ?? ''
    },
    windowsRead: () => {
      throw new Error('not Windows')
    }
  }
}

/** The database manager startup creates without a database, faked. */
function fakes() {
  const deps = { manager: vi.fn(() => ({}) as unknown as DatabaseManager) }
  return { deps }
}

describe('desktop auth mode at startup', () => {
  beforeEach(() => setAccessProvider(passThroughProvider))

  it('installs nothing without the admin config file', () => {
    const { deps } = fakes()
    expect(installDesktopAuth(sourceWith(undefined), deps)).toBeUndefined()
    expect(getDesktopAuth()).toBeUndefined()
    expect(getAccessGate().requiresSignIn()).toBe(false)
    expect(deps.manager).not.toHaveBeenCalled()
  })

  it('locks the desktop behind platform sign-in with a valid file', () => {
    const { deps } = fakes()
    const auth = installDesktopAuth(sourceWith(PLATFORM), deps)!
    expect(getDesktopAuth()).toBe(auth)
    expect(getAccessGate().requiresSignIn()).toBe(true)
    // Platform mode: local accounts are refused.
    expect(() => getAccessGate().assertAllowed('auth:login')).toThrow()
    expect(auth.status()).toEqual({ mode: 'platform', state: 'locked', issuer: CONFIG.issuer })
    // Startup creates the manager without data.
    auth.startWithoutData()
    expect(deps.manager).toHaveBeenCalledOnce()
  })

  it('keeps the data locked for good when the file is refused or cannot be read', () => {
    const throwing = sourceWith(undefined)
    throwing.fs.probe = () => {
      throw new Error('boom')
    }
    for (const source of [sourceWith('not json'), throwing]) {
      const auth = installDesktopAuth(source, fakes().deps)!
      const status = auth.status()
      expect(status.mode === 'platform' && status.state).toBe('misconfigured')
      expect(getAccessGate().requiresSignIn()).toBe(true)
      expect(() => auth.provider.unlock({ subject: 's', signedInAt: 0 })).toThrow()
    }
  })
})

describe('platform access provider', () => {
  it('opens with a session and closes on lock', () => {
    const provider = PlatformAccessProvider.configured(CONFIG)
    expect(provider.isUnlocked()).toBe(false)
    provider.unlock({ subject: 'subject-1', signedInAt: 1 })
    expect(provider.status()).toEqual({
      mode: 'platform',
      state: 'signed-in',
      issuer: CONFIG.issuer
    })
    expect(provider.currentSession()?.subject).toBe('subject-1')
    provider.lock()
    expect(provider.isUnlocked()).toBe(false)
    expect(provider.currentSession()).toBeNull()
  })
})
