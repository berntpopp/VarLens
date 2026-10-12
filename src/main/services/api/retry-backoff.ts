/**
 * The retry delay every external API client uses: exponential growth from a
 * base, full jitter (a random share of it, so clients do not retry in step)
 * and a cap. Policies live in API_CONFIG.
 */

export interface BackoffPolicy {
  baseMs: number
  factor: number
  capMs: number
}

/** Delay before retry number `retry` (1 = the first retry). */
export function backoffDelay(
  retry: number,
  policy: BackoffPolicy,
  random: () => number = Math.random
): number {
  const ceiling = Math.min(policy.capMs, policy.baseMs * policy.factor ** (retry - 1))
  return Math.floor(random() * ceiling)
}

/**
 * An AbortSignal that fires after `ms` (a TimeoutError, like AbortSignal.timeout)
 * on an ordinary timer, so it can be cleared once the work is done.
 */
export function deadlineSignal(ms: number): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController()
  const timer = setTimeout(
    () => controller.abort(new DOMException('The operation timed out.', 'TimeoutError')),
    ms
  )
  return { signal: controller.signal, clear: () => clearTimeout(timer) }
}

/** A Retry-After header (seconds or an HTTP date) in ms from `now`; null when absent or invalid. */
export function retryAfterMs(header: string | null, now: number = Date.now()): number | null {
  if (header === null) return null
  if (/^\d+$/.test(header.trim())) return Number(header) * 1000
  const at = Date.parse(header)
  return Number.isNaN(at) ? null : Math.max(0, at - now)
}
