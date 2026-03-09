export const API_CONFIG = {
  /** VEP API minimum time between requests (ms) — 15 req/sec */
  VEP_MIN_TIME_MS: 67,
  /** VEP hourly rate limit */
  VEP_HOURLY_LIMIT: 55000,
  /** Import progress throttle interval (ms) */
  PROGRESS_THROTTLE_MS: 100
} as const
