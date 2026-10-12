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
  /**
   * Byte budget of one import batch (64 MiB of source data). A batch is
   * flushed at BATCH_INSERT_SIZE rows or at this many bytes, whichever comes
   * first. Typical records are 1-5 KB, so a full 10,000-row batch is 10-50 MB
   * and never reaches it; it only bites on pathologically large records.
   * Equal to the VCF line cap, so the worst case is one maximal line plus
   * the budget.
   */
  BATCH_INSERT_MAX_BYTES: 64 * 1024 * 1024,
  /** Largest batch size (rows) an import worker accepts in its start message. */
  BATCH_INSERT_MAX_ROWS: 50_000,
  /** API cache TTL in days */
  CACHE_TTL_DAYS: 30,
  /** Interval between periodic API cache cleanup runs (ms) — 6 hours */
  CACHE_CLEANUP_INTERVAL_MS: 21_600_000,
  /** Max recent databases in history */
  MAX_RECENT_DATABASES: 5,
  /** Worker pool idle timeout in ms — balances thread churn vs memory on desktop */
  WORKER_IDLE_TIMEOUT_MS: 90_000,
  /** Files SQLite keeps next to a database; writing over one corrupts it. */
  SIDECAR_SUFFIXES: ['-wal', '-shm', '-journal'],
  /**
   * Leading bytes of files that cannot be an encrypted VarLens database: the
   * cipher keeps no plaintext header, so a plain SQLite header that fails to
   * read means a damaged file, and a ZIP header means an XLSX or archive.
   */
  NON_DATABASE_SIGNATURES: ['SQLite format 3\0', 'PK\x03\x04'],
  /** User-facing copy for database-file problems. */
  MESSAGES: {
    NOT_A_DATABASE: 'This file is not a VarLens database or is damaged.',
    NO_DATABASE_OPEN:
      'No database is open. Create or open one from the database menu in the toolbar.',
    EXPORT_TARGET_IS_DATABASE: 'This file is a VarLens database. Choose a different file name.'
  }
} as const
