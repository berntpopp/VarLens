export const API_CONFIG = {
  /** VEP API minimum time between requests (ms) — 15 req/sec */
  VEP_MIN_TIME_MS: 67,
  /** VEP hourly rate limit */
  VEP_HOURLY_LIMIT: 55000,
  /** External lookup request timeout (ms) — a stalled request must free its limiter slot */
  LOOKUP_TIMEOUT_MS: 15_000,
  /** gnomAD gene-wide queries are slower than single-variant lookups */
  GNOMAD_TIMEOUT_MS: 30_000,
  /** Import progress throttle interval (ms) */
  PROGRESS_THROTTLE_MS: 100
} as const
