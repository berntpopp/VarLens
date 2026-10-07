/**
 * Whether a query may run: `window.api` exists and the open database's storage
 * backend supports the feature. Fails closed until the capability document has
 * loaded. Reads reactive state, so a query's options are recomputed when the
 * answer changes.
 */
import type { CapabilityFeature } from '../../../shared/ipc/capability-features'
import type { WindowAPI } from '../../../shared/types/api'
import { logService } from '../services/LogService'
import { useCapabilityStore } from '../stores/capabilityStore'
import {
  currentCanUseFeature,
  getCurrentUnsupportedReasonSync,
  type CapabilityPath
} from '../utils/backend-capabilities'

function currentApi(): WindowAPI | undefined {
  return typeof window === 'undefined' ? undefined : window.api
}

export function canQuery(path: CapabilityPath): boolean {
  return currentApi() !== undefined && currentCanUseFeature(path)
}

/** As `canQuery`, for a runtime feature of the capability document. */
export function canQueryFeature(feature: CapabilityFeature): boolean {
  return currentApi() !== undefined && useCapabilityStore().canUse(feature)
}

/** `window.api` for a query function; throws where there is none. */
export function queryApi(): WindowAPI {
  const api = currentApi()
  if (api === undefined) throw new Error('window.api not available (running outside Electron?)')
  return api
}

/**
 * Await a query's current load. An explicit `refresh()` ignores the query's
 * `enabled` option, so the same gate is checked here; a blocked load is
 * logged with its reason and skipped.
 */
export async function loadIfAllowed(
  path: CapabilityPath,
  refresh: () => Promise<unknown>
): Promise<void> {
  if (canQuery(path)) {
    await refresh()
    return
  }
  const reason = getCurrentUnsupportedReasonSync(path) ?? 'window.api is not available'
  logService.warn(reason, 'backend-capabilities')
}
