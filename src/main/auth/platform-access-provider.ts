/**
 * The access provider for platform sign-in (#295): locked until somebody
 * signs in through the identity provider the admin config file names.
 *
 * A config file that was refused gives a provider that never unlocks, so a
 * broken or untrusted file keeps the data closed instead of switching the
 * sign-in off.
 */
import type { DesktopAuthStatus } from '../../shared/auth/desktop-auth-status'
import type { AccessProvider } from './access-gate'
import type { DesktopAuthConfig } from './desktop-auth-config'

export interface PlatformSession {
  /** The identity provider's stable subject. */
  subject: string
  /** Epoch milliseconds. */
  signedInAt: number
}

type Setup = { config: DesktopAuthConfig } | { problem: string }

export class PlatformAccessProvider implements AccessProvider {
  readonly mode = 'platform' as const
  private session: PlatformSession | null = null

  private constructor(private readonly setup: Setup) {}

  static configured(config: DesktopAuthConfig): PlatformAccessProvider {
    return new PlatformAccessProvider({ config })
  }

  static misconfigured(problem: string): PlatformAccessProvider {
    return new PlatformAccessProvider({ problem })
  }

  /** The sign-in settings, or undefined when the config file was refused. */
  get config(): DesktopAuthConfig | undefined {
    return 'config' in this.setup ? this.setup.config : undefined
  }

  isUnlocked(): boolean {
    return this.session !== null
  }

  currentSession(): PlatformSession | null {
    return this.session
  }

  unlock(session: PlatformSession): void {
    if (!('config' in this.setup)) throw new Error('A refused config file never unlocks')
    this.session = session
  }

  lock(): void {
    this.session = null
  }

  status(): DesktopAuthStatus {
    if (!('config' in this.setup)) {
      return { mode: 'platform', state: 'misconfigured', problem: this.setup.problem }
    }
    return {
      mode: 'platform',
      state: this.session === null ? 'locked' : 'signed-in',
      issuer: this.setup.config.issuer
    }
  }
}
