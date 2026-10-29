/**
 * The desktop platform sign-in at runtime (#295).
 *
 * `installDesktopAuth` reads the admin config file once at startup. No file:
 * nothing is installed and the gate keeps its pass-through provider, so the
 * desktop takes no sign-in path at all. A valid file: platform sign-in, locked
 * until somebody signs in. A refused file, or any error while reading it:
 * locked for good, with the reason on the sign-in screen and in the log.
 */
import { writeFileSync } from 'fs'
import { app, BrowserWindow, powerMonitor, shell } from 'electron'
import type { DesktopAuthStatus, DesktopSignInResult } from '../../shared/auth/desktop-auth-status'
import { getDbKeyStore, setOsKeyWrapAllowed } from '../database/db-key-store-instance'
import { initDatabaseManagerSafe } from '../database/index'
import { openConfiguredDatabase } from '../database/startup'
import { triggerStartupRebuildIfNeeded } from '../ipc/handlers/cohort'
import { apiFetch } from '../services/api/http-fetch'
import type { DatabaseManager, OpenGuard } from '../services/DatabaseManager'
import type { JobRunner } from '../services/jobs/JobRunner'
import { jobRunner } from '../services/jobs/runner'
import { mainLogger } from '../services/MainLogger'
import { startSqliteHousekeeping } from '../startup-sequence'
import { setAccessProvider } from './access-gate'
import { platformIdentity, platformOpenGuard } from './database-binding'
import {
  isTrustedIdpUrl,
  readDesktopAuthConfig,
  type ConfigSource,
  type DesktopAuthConfigResult
} from './desktop-auth-config'
import { nodeConfigSource } from './desktop-auth-config-source'
import type { Fetch } from './oidc-provider'
import { PlatformAccessProvider } from './platform-access-provider'
import { PlatformSignIn } from './platform-sign-in'
import { SessionLock, type LockReason, type LockSignals } from './session-lock'

export interface DesktopAuthDependencies {
  /** The database manager; created without a database when there is none yet. */
  manager(): DatabaseManager
  /** Open the default database on `manager` as startup does, once a session starts. */
  openDefaultDatabase(manager: DatabaseManager): Promise<void>
  /** Reload every window: into the app after a sign-in, the sign-in screen after a lock. */
  reloadWindows(): void
  jobs: Pick<JobRunner, 'list' | 'cancel' | 'pruneTerminalJobs'>
  lockSignals: LockSignals
  fetch: Fetch
  /** Opens the authorization request in the system browser. */
  openBrowser(url: string): Promise<void>
  /** True when the OS credential store holds a wrap of this key. */
  osUnlockable(key: string): boolean
  setOsKeyWrapAllowed(allowed: boolean): void
  log(level: 'info' | 'warn' | 'error', message: string): void
  /** How long a lock waits before it looks again for running work. */
  waitForWork?(): Promise<void>
  /** How long a new session waits for the last one's close (default 5 s). */
  closeWaitMs?: number
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function settlesWithin(work: Promise<void>, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<false>((resolve) => (timer = setTimeout(() => resolve(false), ms)))
  try {
    return await Promise.race([work.then(() => true), timeout])
  } finally {
    clearTimeout(timer)
  }
}

/** One installed sign-in mode: its provider, the sign-in flow and the session lock. */
export class DesktopAuth {
  private signInFlow: PlatformSignIn | undefined
  private sessionLock: SessionLock | undefined
  /** The close that follows a lock; the next session waits for it. */
  private pendingClose: Promise<void> = Promise.resolve()
  private readonly guard: OpenGuard

  constructor(
    readonly provider: PlatformAccessProvider,
    private readonly deps: DesktopAuthDependencies
  ) {
    const requirePassphrase = provider.config?.requirePassphrase ?? false
    // With requirePassphrase no key gets an OS wrap. A refused config file has
    // no session ever, so the guard refuses everything there.
    if (requirePassphrase) deps.setOsKeyWrapAllowed(false)
    this.guard = platformOpenGuard({
      identity: () => {
        const session = provider.currentSession()
        const issuer = provider.config?.issuer
        if (session === null || issuer === undefined) return undefined
        return platformIdentity(issuer, session.subject)
      },
      requirePassphrase,
      osUnlockable: deps.osUnlockable
    })
  }

  status(): DesktopAuthStatus {
    return this.provider.status()
  }

  /** Startup: the manager starts without a database, every later open passes the guard. */
  startWithoutData(): void {
    this.manager()
  }

  async signIn(): Promise<DesktopSignInResult> {
    if (this.provider.isUnlocked()) return { outcome: 'signed-in' }
    const config = this.provider.config
    if (config === undefined) {
      return {
        outcome: 'failed',
        message: 'The sign-in configuration on this computer was refused.'
      }
    }
    this.signInFlow ??= new PlatformSignIn({
      config,
      fetch: this.deps.fetch,
      openBrowser: (url) => this.deps.openBrowser(url),
      onSignedIn: (subject) => this.startSession(subject),
      log: (level, text) => this.deps.log(level, text)
    })
    return this.signInFlow.run()
  }

  cancelSignIn(): void {
    this.signInFlow?.cancel()
  }

  /** Open the session once; a second sign-in that also succeeded changes nothing. */
  async startSession(subject: string): Promise<void> {
    const config = this.provider.config
    if (config === undefined || this.provider.isUnlocked()) return
    // A close from the last lock finishes before the next session opens data,
    // and nothing the last account had open stays open for this one. Work that
    // never ends keeps the close waiting; the sign-in then fails and says so.
    if (!(await settlesWithin(this.pendingClose, this.deps.closeWaitMs ?? 5_000))) {
      throw new Error('the last session is still closing')
    }
    if (this.hasOpenDatabase()) await this.closeData()
    if (this.hasOpenDatabase()) throw new Error('the last session could not be closed')
    const signedInAt = Date.now()
    this.sessionLock ??= new SessionLock({
      signals: this.deps.lockSignals,
      idleLockMinutes: config.idleLockMinutes,
      maxSessionMinutes: config.maxSessionMinutes,
      lock: (reason) => void this.lock(reason)
    })
    // The locks run before the gate opens, so no session is ever without them.
    this.sessionLock.start(signedInAt)
    this.provider.unlock({ subject, signedInAt })
    // With requirePassphrase the default database (an OS-unlocked key) stays
    // closed; the user opens a passphrase-protected one.
    if (!config.requirePassphrase) {
      try {
        await this.deps.openDefaultDatabase(this.manager())
      } catch (error) {
        this.deps.log(
          'error',
          `Opening the default database after sign-in failed: ${message(error)}`
        )
      }
    }
    try {
      this.deps.reloadWindows()
    } catch (error) {
      this.deps.log('warn', `Reloading the window after sign-in failed: ${message(error)}`)
    }
  }

  /**
   * Lock the session: the gate refuses at once, running jobs stop, the window
   * drops what it shows, and the database closes with its key discarded as
   * soon as no work runs.
   */
  async lock(reason: LockReason): Promise<void> {
    if (!this.provider.isUnlocked()) return
    this.sessionLock?.stop()
    this.provider.lock()
    this.deps.log('info', `Desktop session locked: ${reason}`)
    for (const job of this.deps.jobs.list({ status: 'running' })) void this.deps.jobs.cancel(job.id)
    this.pendingClose = this.closeData()
    try {
      this.deps.reloadWindows()
    } catch (error) {
      this.deps.log('warn', `Reloading the window after a lock failed: ${message(error)}`)
    }
    await this.pendingClose
  }

  /** Stop the session lock timer; a new install replaces this one. */
  dispose(): void {
    this.sessionLock?.stop()
  }

  private manager(): DatabaseManager {
    const manager = this.deps.manager()
    manager.setOpenGuard(this.guard)
    return manager
  }

  private hasOpenDatabase(): boolean {
    return this.manager().getCurrentSessionOrNull() !== null
  }

  /** Close the data once no work runs against it; jobs that end meanwhile are waited for. */
  private async closeData(): Promise<void> {
    try {
      const wait = this.deps.waitForWork ?? (() => new Promise((r) => setTimeout(r, 1_000)))
      if (!(await this.manager().lock())) {
        this.deps.log('info', 'The lock waits for running work to end before it closes the data')
        do await wait()
        while (!(await this.manager().lock()))
      }
    } catch (error) {
      this.deps.log('error', `Closing the data after a lock failed: ${message(error)}`)
    } finally {
      // Finished jobs name this account's files, which the next account on
      // this computer must not see.
      this.deps.jobs.pruneTerminalJobs(0)
    }
  }
}

function electronLockSignals(): LockSignals {
  return {
    idleSeconds: () => powerMonitor.getSystemIdleTime(),
    idleState: () => powerMonitor.getSystemIdleState(1),
    onOsLock: (listener) => {
      powerMonitor.on('lock-screen', listener)
      powerMonitor.on('suspend', listener)
      return () => {
        powerMonitor.off('lock-screen', listener)
        powerMonitor.off('suspend', listener)
      }
    }
  }
}

/**
 * The URL is the provider's discovered authorization endpoint, checked in
 * oidc-provider.ts; the domain allowlist of isUrlSafeForExternal does not
 * apply to an identity provider an administrator configured. The scheme is
 * checked once more right at the sink. Development builds only:
 * VARLENS_E2E_SIGN_IN_URL_FILE receives the request instead of the browser,
 * so an end-to-end test can drive the identity provider itself.
 */
async function openBrowser(url: string): Promise<void> {
  if (!isTrustedIdpUrl(new URL(url), !app.isPackaged)) {
    throw new Error('the sign-in address must use https')
  }
  const testFile = process.env.VARLENS_E2E_SIGN_IN_URL_FILE?.trim() ?? ''
  if (!app.isPackaged && testFile !== '') {
    writeFileSync(testFile, url, { mode: 0o600 })
    return
  }
  await shell.openExternal(url)
}

function electronDependencies(): DesktopAuthDependencies {
  return {
    manager: initDatabaseManagerSafe,
    // The same open and housekeeping as startup (initDatabaseManager and
    // onOpened in src/main/index.ts), on the manager that carries the guard.
    openDefaultDatabase: async (manager) => {
      await openConfiguredDatabase(manager, {
        env: process.env,
        userDataPath: app.getPath('userData'),
        keyStore: getDbKeyStore()
      })
      try {
        startSqliteHousekeeping(manager, triggerStartupRebuildIfNeeded)
      } catch (error) {
        mainLogger.warn(`Housekeeping after sign-in failed: ${message(error)}`, 'database')
      }
    },
    reloadWindows: () => {
      for (const window of BrowserWindow.getAllWindows()) window.webContents.reload()
    },
    jobs: jobRunner,
    lockSignals: electronLockSignals(),
    fetch: apiFetch,
    openBrowser,
    osUnlockable: (key) => getDbKeyStore().findManagedKeyIdForDek(key) !== null,
    setOsKeyWrapAllowed,
    log: (level, text) => mainLogger[level](text, 'auth')
  }
}

function readConfig(source: ConfigSource): DesktopAuthConfigResult {
  try {
    return readDesktopAuthConfig(source)
  } catch (error) {
    const problem = `could not be read: ${message(error)}`
    return { kind: 'invalid', path: 'the sign-in configuration', problem }
  }
}

let installed: DesktopAuth | undefined

/** Read the admin config file and set up its sign-in; call once, before IPC registers. */
export function installDesktopAuth(
  source: ConfigSource = nodeConfigSource(),
  deps: DesktopAuthDependencies = electronDependencies()
): DesktopAuth | undefined {
  installed?.dispose()
  installed = undefined
  const result = readConfig(source)
  if (result.kind === 'none') return undefined
  const provider =
    result.kind === 'platform'
      ? PlatformAccessProvider.configured(result.config)
      : PlatformAccessProvider.misconfigured(result.problem)
  installed = new DesktopAuth(provider, deps)
  setAccessProvider(provider)
  if (result.kind === 'invalid') {
    mainLogger.error(`Desktop sign-in config refused, data stays locked: ${result.problem}`, 'auth')
  } else {
    mainLogger.info(`Desktop sign-in configured by ${result.path}`, 'auth')
  }
  return installed
}

/** The installed sign-in mode, undefined without the admin config file. */
export function getDesktopAuth(): DesktopAuth | undefined {
  return installed
}
