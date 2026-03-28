export const DATABASE_CONFIG = {
  /**
   * SQLite page size in bytes. 8192 is optimal for variant-heavy databases:
   * - Larger rows (variants have 20+ columns) fit better in fewer pages
   * - Fewer page reads for table scans and index lookups
   * - Must be set BEFORE any tables are created (only applies to new databases)
   */
  PAGE_SIZE: 8192,
  /** SQLite cache size in KB (negative = KB, positive = pages) */
  CACHE_SIZE_KB: -32000,
  /** SQLite cache size for import worker (64 MB, larger for bulk writes) */
  IMPORT_CACHE_SIZE_KB: -64000,
  /** Memory-mapped I/O size in bytes (1 GB — virtual address reservation is free on 64-bit) */
  MMAP_SIZE_BYTES: 1_073_741_824,
  /** Busy timeout in milliseconds */
  BUSY_TIMEOUT_MS: 5000,
  /** Max rows sampled per table during ANALYZE (caps optimizer stat-gathering time) */
  ANALYSIS_LIMIT: 400,
  /** Batch insert size for variant imports */
  BATCH_INSERT_SIZE: 10_000,
  /** API cache TTL in days */
  CACHE_TTL_DAYS: 30,
  /** Interval between periodic API cache cleanup runs (ms) — 6 hours */
  CACHE_CLEANUP_INTERVAL_MS: 21_600_000,
  /** Max recent databases in history */
  MAX_RECENT_DATABASES: 5,
  /** Worker pool idle timeout in ms — balances thread churn vs memory on desktop */
  WORKER_IDLE_TIMEOUT_MS: 90_000
} as const
