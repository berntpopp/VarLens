export const API_CONFIG = {
  /** VEP API minimum time between requests (ms) — 15 req/sec */
  VEP_MIN_TIME_MS: 67,
  /** VEP hourly rate limit */
  VEP_HOURLY_LIMIT: 55000,
  /** External lookup request timeout (ms) — a stalled request must free its limiter slot */
  LOOKUP_TIMEOUT_MS: 15_000,
  /** HPO autocomplete (NLM Clinical Tables) — typed search, so a shorter deadline */
  HPO_TIMEOUT_MS: 10_000,
  /**
   * Ensembl REST answers in 0.5–26 s from here (measured 2026-10-12, small
   * genes included), so one lookup gets longer than the generic timeout and
   * one retry after a short backoff.
   */
  ENSEMBL_TIMEOUT_MS: 25_000,
  /** One deadline for a whole gene-structure lookup (both calls, every retry) */
  ENSEMBL_DEADLINE_MS: 50_000,
  ENSEMBL_MAX_ATTEMPTS: 3,
  /** Retry delays of every external API client: exponential, full jitter, capped */
  RETRY_BACKOFF: { baseMs: 1_000, factor: 2, capMs: 8_000 },
  /** A 429 asking to wait longer than this is reported instead of waited out */
  RETRY_AFTER_CAP_MS: 10_000,
  /** VEP retries a 429 this many times (Bottleneck failed hook) */
  VEP_MAX_RETRIES: 3,
  /** gnomAD gene-wide queries are slower than single-variant lookups */
  GNOMAD_TIMEOUT_MS: 30_000,
  /** Import progress throttle interval (ms) */
  PROGRESS_THROTTLE_MS: 100
} as const
