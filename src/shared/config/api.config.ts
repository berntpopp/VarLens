export const API_CONFIG = {
  /** VEP API minimum time between requests (ms) — 15 req/sec */
  VEP_MIN_TIME_MS: 67,
  /** VEP hourly rate limit */
  VEP_HOURLY_LIMIT: 55000,
  /** External lookup request timeout (ms) — a stalled request must free its limiter slot */
  LOOKUP_TIMEOUT_MS: 15_000,
  /**
   * Ensembl REST answers in 0.5–26 s from here (measured 2026-10-12, small
   * genes included), so one lookup gets longer than the generic timeout and
   * one retry after a short backoff.
   */
  ENSEMBL_TIMEOUT_MS: 25_000,
  ENSEMBL_RETRIES: 1,
  ENSEMBL_RETRY_BACKOFF_MS: 1_000,
  /** gnomAD gene-wide queries are slower than single-variant lookups */
  GNOMAD_TIMEOUT_MS: 30_000,
  /** Import progress throttle interval (ms) */
  PROGRESS_THROTTLE_MS: 100
} as const
