/**
 * The desktop platform sign-in at runtime (#295).
 *
 * `installDesktopAuth` reads the admin config file once at startup. No file:
 * nothing is installed and the gate keeps its pass-through provider, so the
 * desktop takes no sign-in path at all. A valid file: platform sign-in, locked
 * until somebody signs in. A refused file, or any error while reading it:
 * locked for good, with the reason on the sign-in screen and in the log.
 */
import type { DesktopAuthStatus } from '../../shared/auth/desktop-auth-status'
import { initDatabaseManagerSafe } from '../database/index'
import type { DatabaseManager } from '../services/DatabaseManager'
import { mainLogger } from '../services/MainLogger'
import { setAccessProvider } from './access-gate'
import {
  readDesktopAuthConfig,
  type ConfigSource,
  type DesktopAuthConfigResult
} from './desktop-auth-config'
import { nodeConfigSource } from './desktop-auth-config-source'
import { PlatformAccessProvider } from './platform-access-provider'

export interface DesktopAuthDependencies {
  /** The database manager; created without a database when there is none yet. */
  manager(): DatabaseManager
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** One installed sign-in mode and its provider. */
export class DesktopAuth {
  constructor(
    readonly provider: PlatformAccessProvider,
    private readonly deps: DesktopAuthDependencies
  ) {}

  status(): DesktopAuthStatus {
    return this.provider.status()
  }

  /** Startup: the manager starts without a database; nothing opens before sign-in. */
  startWithoutData(): void {
    this.deps.manager()
  }
}

function electronDependencies(): DesktopAuthDependencies {
  return { manager: initDatabaseManagerSafe }
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
