/**
 * The main-process access gate in front of every IPC channel.
 *
 * One provider per auth mode decides whether data channels may run. The
 * default provider lets everything through, so a desktop without a sign-in
 * mode takes the same tested path as one with it rather than a special case.
 * In a sign-in mode IPC is deny-by-default: until the provider reports a
 * session, only the channels in {@link CHANNELS_WITHOUT_SESSION} answer, and
 * everything else gets an UNAUTHENTICATED envelope without its handler running.
 * The check is made per call, so locking takes effect on handlers that are
 * already registered.
 */
import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import type { DesktopAuthMode } from '../../shared/auth/desktop-auth-mode'
import { ErrorCode } from '../../shared/types/errors'
import { AppError } from '../ipc/errors'
import { wrapHandler } from '../ipc/errorHandler'

export interface AccessProvider {
  readonly mode: DesktopAuthMode
  /** True while data channels may run. */
  isUnlocked(): boolean
}

/** The `none` mode: no sign-in, every channel answers. */
export const passThroughProvider: AccessProvider = {
  mode: 'none',
  isUnlocked: () => true
}

/**
 * Channels that answer without a session in a sign-in mode. They carry no
 * data: the renderer needs its capabilities, the version and the sign-in
 * state to boot and to show the sign-in screen.
 */
export const CHANNELS_WITHOUT_SESSION: ReadonlySet<string> = new Set([
  'system:capabilities',
  'system:version',
  'auth:desktopStatus'
])

/**
 * The local accounts' channels. Platform mode replaces local accounts (#295),
 * so in that mode they are refused, signed in or not, whatever a database's
 * `accounts_enabled` flag says, as the web does under platform sign-in.
 */
export const LOCAL_ACCOUNT_CHANNELS: readonly string[] = [
  'auth:login',
  'auth:logout',
  'auth:currentUser',
  'auth:isAccountsEnabled',
  'auth:createUser',
  'auth:listUsers',
  'auth:deactivateUser',
  'auth:reactivateUser',
  'auth:setRole',
  'auth:resetPassword',
  'auth:changePassword'
]

/** What platform mode refuses, signed in or not, and why. */
const PLATFORM_MODE_REFUSALS: ReadonlyMap<string, string> = new Map([
  ...LOCAL_ACCOUNT_CHANNELS.map(
    (channel) =>
      [
        channel,
        'This VarLens signs in through your organisation; local accounts are switched off.'
      ] as const
  )
])

export class AccessGate {
  constructor(private readonly provider: AccessProvider) {}

  /** True when a sign-in mode is active and nobody is signed in. */
  requiresSignIn(): boolean {
    return this.provider.mode !== 'none' && !this.provider.isUnlocked()
  }

  /** Throws when `channel` may not run right now. */
  assertAllowed(channel: string): void {
    const refusal =
      this.provider.mode === 'platform' ? PLATFORM_MODE_REFUSALS.get(channel) : undefined
    if (refusal !== undefined) {
      throw new AppError(
        ErrorCode.FORBIDDEN,
        `IPC channel ${channel} refused in platform mode`,
        refusal
      )
    }
    if (!this.requiresSignIn() || CHANNELS_WITHOUT_SESSION.has(channel)) return
    throw new AppError(
      ErrorCode.UNAUTHENTICATED,
      `IPC channel ${channel} refused: sign-in required`,
      'Sign in to open your data.'
    )
  }
}

let gate = new AccessGate(passThroughProvider)

export function getAccessGate(): AccessGate {
  return gate
}

/** Install the provider for the resolved auth mode (startup, and tests). */
export function setAccessProvider(provider: AccessProvider): void {
  gate = new AccessGate(provider)
}

type InvokeHandler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown

/**
 * Listener registrations that would bypass the per-call check. Data channels
 * register through `handle`; one of these on the gated object is refused at
 * startup rather than silently answering while locked.
 */
const UNGATED_REGISTRATIONS: ReadonlySet<PropertyKey> = new Set([
  'handleOnce',
  'on',
  'once',
  'addListener',
  'prependListener',
  'prependOnceListener'
])

/**
 * Wrap `ipcMain` so every `handle(...)` registration first asks the access
 * gate. Other listener registrations throw; all remaining members pass
 * through untouched.
 */
export function gateIpcMainOnAccess(ipcMain: IpcMain): IpcMain {
  const handle = (channel: string, listener: InvokeHandler): void => {
    ipcMain.handle(channel, async (event, ...args) => {
      try {
        getAccessGate().assertAllowed(channel)
      } catch (refusal) {
        return wrapHandler(async () => {
          throw refusal
        })
      }
      return listener(event, ...args)
    })
  }
  return new Proxy(ipcMain, {
    get(target, property, receiver) {
      if (property === 'handle') return handle
      if (UNGATED_REGISTRATIONS.has(property)) {
        return () => {
          throw new Error(`ipcMain.${String(property)} bypasses the access gate; use handle`)
        }
      }
      const value: unknown = Reflect.get(target, property, receiver)
      return typeof value === 'function' ? value.bind(target) : value
    }
  })
}
