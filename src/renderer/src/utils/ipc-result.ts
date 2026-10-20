import { unwrapIpcResult } from '../../../shared/types/errors'
import type { IpcResult } from '../../../shared/types/errors'
import { formatErrorMessage } from '../../../shared/errors/format-error-message'

export function expectIpcResult<T>(result: IpcResult<T>): T {
  return unwrapIpcResult(result)
}

/**
 * Human-readable text for anything a renderer `catch` receives: an `Error`,
 * a `SerializableError` thrown by `unwrapIpcResult`, a string, or an opaque
 * object. Always returns a string and never `[object Object]` (parity spec
 * §4.4); prefer it over `String(err)` in UI error paths.
 */
export function formatError(error: unknown, fallback = 'An unexpected error occurred.'): string {
  const message = formatErrorMessage(error, fallback)
  return message === '[object Object]' || message.trim() === '' ? fallback : message
}
