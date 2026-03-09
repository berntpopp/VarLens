export const DATABASE_CONFIG = {
  /** SQLite cache size in KB (negative = KB, positive = pages) */
  CACHE_SIZE_KB: -32000,
  /** Memory-mapped I/O size in bytes (256 MB) */
  MMAP_SIZE_BYTES: 268_435_456,
  /** Busy timeout in milliseconds */
  BUSY_TIMEOUT_MS: 5000,
  /** Batch insert size for variant imports */
  BATCH_INSERT_SIZE: 5000,
  /** API cache TTL in days */
  CACHE_TTL_DAYS: 30,
  /** Max recent databases in history */
  MAX_RECENT_DATABASES: 5
} as const
