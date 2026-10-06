/**
 * Shared types for main-process domain handler factories (spec §4.1, Limin L1).
 */

import type { StorageSession } from '../storage/session'
import type { PlatformPort } from '../platform/platform-port'
import type { DomainHandlers, UnwrappedResult } from '../../shared/types/handler-core'

export type { DomainHandlers, UnwrappedResult }

export interface DomainHandlerDependencies {
  getSession: () => StorageSession
  platform?: PlatformPort
}
