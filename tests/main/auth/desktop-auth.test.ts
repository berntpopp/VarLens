import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Stats } from 'fs'

vi.mock('@electron-toolkit/utils', () => ({ is: { dev: false } }))
vi.mock('electron', () => ({ app: { isPackaged: true, getPath: () => '' } }))

import {
  getAccessGate,
  passThroughProvider,
  setAccessProvider
} from '../../../src/main/auth/access-gate'
import {
  getDesktopAuth,
  installDesktopAuth,
  type DesktopAuthDependencies
} from '../../../src/main/auth/desktop-auth'
import type { ConfigSource, DesktopAuthConfig } from '../../../src/main/auth/desktop-auth-config'
import { PlatformAccessProvider } from '../../../src/main/auth/platform-access-provider'
import type { DatabaseManager } from '../../../src/main/services/DatabaseManager'
import { JobRunner } from '../../../src/main/services/jobs/JobRunner'

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

/** A database manager and the rest of Electron, faked; `open` says whether data is open. */
function fakes() {
  const state = { open: false }
  const manager = {
    setOpenGuard: vi.fn(),
    getCurrentSessionOrNull: () => (state.open ? ({} as never) : null),
    lock: vi.fn(async () => {
      state.open = false
      return true
    })
  }
  const deps: DesktopAuthDependencies = {
    manager: vi.fn(() => manager as unknown as DatabaseManager),
    openDefaultDatabase: vi.fn(async () => {
      state.open = true
    }),
    reloadWindows: vi.fn(),
    jobs: new JobRunner(),
    lockSignals: {
      idleSeconds: () => 0,
      idleState: () => 'active',
      onOsLock: () => () => undefined
    },
    fetch: vi.fn(),
    openBrowser: vi.fn(async () => undefined),
    osUnlockable: () => false,
    setOsKeyWrapAllowed: vi.fn(),
    log: vi.fn(),
    waitForWork: async () => undefined
  }
  return { state, manager, deps }
}

describe('desktop auth mode at startup', () => {
  beforeEach(() => setAccessProvider(passThroughProvider))

  it('installs nothing without the admin config file', () => {
    const { deps } = fakes()
    expect(installDesktopAuth(sourceWith(undefined), deps)).toBeUndefined()
    expect(getDesktopAuth()).toBeUndefined()
    expect(getAccessGate().requiresSignIn()).toBe(false)
    expect(deps.manager).not.toHaveBeenCalled()
    expect(deps.setOsKeyWrapAllowed).not.toHaveBeenCalled()
  })

  it('locks the desktop behind platform sign-in with a valid file', () => {
    const { deps, manager } = fakes()
    const auth = installDesktopAuth(sourceWith(PLATFORM), deps)!
    expect(getDesktopAuth()).toBe(auth)
    // Platform mode: local accounts are refused.
    expect(() => getAccessGate().assertAllowed('auth:login')).toThrow()
    expect(getAccessGate().requiresSignIn()).toBe(true)
    expect(auth.status()).toEqual({ mode: 'platform', state: 'locked', issuer: CONFIG.issuer })
    // Startup creates the manager without data and installs the guard on it.
    auth.startWithoutData()
    expect(manager.setOpenGuard).toHaveBeenCalledOnce()
    expect(deps.setOsKeyWrapAllowed).not.toHaveBeenCalled()
  })

  it('keeps the data locked for good when the file is refused or cannot be read', async () => {
    const throwing = sourceWith(undefined)
    throwing.fs.probe = () => {
      throw new Error('boom')
    }
    for (const source of [sourceWith('not json'), throwing]) {
      const auth = installDesktopAuth(source, fakes().deps)!
      const status = auth.status()
      expect(status.mode === 'platform' && status.state).toBe('misconfigured')
      expect(getAccessGate().requiresSignIn()).toBe(true)
      await expect(auth.signIn()).resolves.toMatchObject({ outcome: 'failed' })
      expect(() => auth.provider.unlock({ subject: 's', signedInAt: 0 })).toThrow()
    }
  })

  it('turns off new OS key wraps when a passphrase is required', () => {
    const { deps } = fakes()
    installDesktopAuth(
      sourceWith(JSON.stringify({ mode: 'platform', ...CONFIG, requirePassphrase: true })),
      deps
    )
    expect(deps.setOsKeyWrapAllowed).toHaveBeenCalledWith(false)
  })
})

describe('a desktop session', () => {
  beforeEach(() => setAccessProvider(passThroughProvider))

  it('opens once, then reloads the window into the app', async () => {
    const { deps } = fakes()
    const auth = installDesktopAuth(sourceWith(PLATFORM), deps)!
    await auth.startSession('subject-1')
    await auth.startSession('subject-2')
    expect(deps.openDefaultDatabase).toHaveBeenCalledOnce()
    expect(deps.reloadWindows).toHaveBeenCalledOnce()
    expect(auth.provider.currentSession()?.subject).toBe('subject-1')
    expect(getAccessGate().requiresSignIn()).toBe(false)
    await expect(auth.signIn()).resolves.toEqual({ outcome: 'signed-in' })
    auth.dispose()
  })

  it('keeps the default database closed when a passphrase is required', async () => {
    const { deps } = fakes()
    const config = JSON.stringify({ mode: 'platform', ...CONFIG, requirePassphrase: true })
    const auth = installDesktopAuth(sourceWith(config), deps)!
    await auth.startSession('subject-1')
    expect(deps.openDefaultDatabase).not.toHaveBeenCalled()
    expect(deps.reloadWindows).toHaveBeenCalledOnce()
    auth.dispose()
  })

  it('locks: the gate refuses at once, the window reloads, the data closes', async () => {
    const { deps, manager, state } = fakes()
    const auth = installDesktopAuth(sourceWith(PLATFORM), deps)!
    await auth.startSession('subject-1')
    expect(state.open).toBe(true)
    await auth.lock('user')
    expect(getAccessGate().requiresSignIn()).toBe(true)
    expect(deps.reloadWindows).toHaveBeenCalledTimes(2)
    expect(manager.lock).toHaveBeenCalledOnce()
    expect(state.open).toBe(false)
    // Locking a locked session changes nothing.
    await auth.lock('user')
    expect(deps.reloadWindows).toHaveBeenCalledTimes(2)
  })

  it('waits for running work before it closes the data', async () => {
    const { deps, manager } = fakes()
    manager.lock.mockResolvedValueOnce(false).mockResolvedValueOnce(false)
    const waitForWork = vi.fn(async () => undefined)
    const auth = installDesktopAuth(sourceWith(PLATFORM), { ...deps, waitForWork })!
    await auth.startSession('subject-1')
    await auth.lock('inactivity')
    expect(waitForWork).toHaveBeenCalledTimes(2)
    expect(manager.lock).toHaveBeenCalledTimes(3)
  })

  it('cancels running jobs and forgets finished ones on lock', async () => {
    const { deps } = fakes()
    const auth = installDesktopAuth(sourceWith(PLATFORM), deps)!
    await auth.startSession('subject-1')
    const done = deps.jobs.enqueue('export', {}, async () => undefined)
    await done.result
    const running = deps.jobs.enqueue('import_batch', {}, (context) => {
      return new Promise<void>((_, reject) => {
        context.signal.addEventListener('abort', () => reject(new Error('cancelled')))
      })
    })
    await auth.lock('user')
    await running.result.catch(() => undefined)
    expect(deps.jobs.list({ status: 'running' })).toHaveLength(0)
    expect(deps.jobs.get(done.id)).toBeUndefined()
  })

  it('waits for the last close and refuses to unlock over leftover data', async () => {
    const { deps, manager, state } = fakes()
    const auth = installDesktopAuth(sourceWith(PLATFORM), deps)!
    await auth.startSession('subject-1')
    let finishClose: () => void = () => undefined
    manager.lock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishClose = () => {
            state.open = false
            resolve(true)
          }
        })
    )
    const locking = auth.lock('user')
    const next = auth.startSession('subject-2')
    await new Promise(setImmediate)
    expect(auth.provider.isUnlocked()).toBe(false)
    finishClose()
    await locking
    await next
    expect(auth.provider.currentSession()?.subject).toBe('subject-2')

    manager.lock.mockRejectedValue(new Error('close failed'))
    await auth.lock('user')
    expect(state.open).toBe(true)
    await expect(auth.startSession('subject-3')).rejects.toThrow(/could not be closed/)
    expect(auth.provider.isUnlocked()).toBe(false)
  })

  it('keeps the gate locked when the session locks cannot start', async () => {
    const { deps } = fakes()
    const onOsLock = () => {
      throw new Error('no power monitor')
    }
    const auth = installDesktopAuth(sourceWith(PLATFORM), {
      ...deps,
      lockSignals: { ...deps.lockSignals, onOsLock }
    })!
    await expect(auth.startSession('subject-1')).rejects.toThrow('no power monitor')
    expect(auth.provider.isUnlocked()).toBe(false)
    expect(deps.openDefaultDatabase).not.toHaveBeenCalled()
  })

  it('fails a new sign-in, rather than hang, while the last close still waits for work', async () => {
    const { deps, manager, state } = fakes()
    let workRuns = true
    manager.lock.mockImplementation(async () => {
      if (workRuns) return false
      state.open = false
      return true
    })
    const auth = installDesktopAuth(sourceWith(PLATFORM), {
      ...deps,
      waitForWork: () => new Promise(setImmediate),
      closeWaitMs: 20
    })!
    await auth.startSession('subject-1')
    const locking = auth.lock('inactivity')
    await expect(auth.startSession('subject-2')).rejects.toThrow(/still closing/)
    expect(auth.provider.isUnlocked()).toBe(false)
    expect(state.open).toBe(true)
    workRuns = false
    await locking
    expect(state.open).toBe(false)
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
