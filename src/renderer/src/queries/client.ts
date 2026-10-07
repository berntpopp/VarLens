/**
 * The renderer's query cache (Pinia Colada): server-derived, read-mostly data.
 * UI state stays in Pinia stores and composables.
 *
 * Data only changes on known events, so nothing goes stale by time: entries
 * are refreshed by `invalidateServerData` (./invalidation.ts) and by nothing
 * else. `refetchOnMount: true` means "refresh on mount if invalidated or
 * failed"; fresh data is never refetched.
 */
import type { App } from 'vue'
import type { Pinia } from 'pinia'
import { PiniaColada, PiniaColadaQueryHooksPlugin, type PiniaColadaOptions } from '@pinia/colada'

import { ErrorCode, isIpcError } from '../../../shared/types/errors'
import { logService } from '../services/LogService'
import { formatError } from '../utils/ipc-result'

export const QUERY_DEFAULTS = {
  staleTime: Infinity,
  refetchOnMount: true,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false
} as const satisfies PiniaColadaOptions['queryOptions']

/** Every failed query is logged here, once; consumers only read `error`. */
const logFailedQueries = PiniaColadaQueryHooksPlugin({
  onError(error, entry) {
    // Skip the `['db', revision]` root: the rest names the data.
    logService.warn(
      `${entry.key.slice(2).join('/')} failed to load: ${formatError(error)}`,
      'queries'
    )
  }
})

export function installQueryCache(app: App, pinia: Pinia): void {
  app.use(PiniaColada, { pinia, queryOptions: QUERY_DEFAULTS, plugins: [logFailedQueries] })
}

/** Outcomes that repeating the same request cannot change. */
const DETERMINISTIC_ERRORS: ReadonlySet<ErrorCode> = new Set([
  ErrorCode.VALIDATION,
  ErrorCode.NOT_FOUND,
  ErrorCode.FORBIDDEN,
  ErrorCode.UNSUPPORTED_RUNTIME,
  ErrorCode.CONFLICT
])

/**
 * Whether a failed query may be retried. Nothing retries today (the retry
 * plugin is not installed); this is the rule any future retry must follow.
 */
export function isRetryableError(error: unknown): boolean {
  return !(isIpcError(error) && DETERMINISTIC_ERRORS.has(error.code))
}
