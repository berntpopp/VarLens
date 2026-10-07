import type { Database as DatabaseType } from 'better-sqlite3-multiple-ciphers'

/**
 * Manages variant_frequency table CRUD operations.
 *
 * Extracted from VariantRepository to isolate frequency counting logic
 * (update, decrement, recompute) into a focused, independently testable module.
 */
export class VariantFrequencyService {
  constructor(private readonly db: DatabaseType) {}

  /**
   * Update variant_frequency counts for all variants in a case.
   * Called after import to increment shared variant counts.
   */
  updateFrequencies(caseId: number): void {
    this.db
      .prepare(
        `
      INSERT INTO variant_frequency (chr, pos, ref, alt, case_count)
      SELECT DISTINCT chr, pos, ref, alt, 1
      FROM variants WHERE case_id = ?
      ON CONFLICT(chr, pos, ref, alt)
      DO UPDATE SET case_count = case_count + 1
    `
      )
      .run(caseId)
  }

  /**
   * Highest variant id currently stored for a case (0 when it has none).
   * Take this before appending more files to an existing case and pass it to
   * {@link updateFrequenciesForAppend} afterwards.
   */
  caseVariantWatermark(caseId: number): number {
    const row = this.db
      .prepare('SELECT COALESCE(MAX(id), 0) AS watermark FROM variants WHERE case_id = ?')
      .get(caseId) as { watermark: number }
    return row.watermark
  }

  /**
   * Count a case once for every coordinate it gained after `watermark`.
   *
   * The case already contributes exactly 1 to every coordinate it held at
   * the watermark (its earlier rows were counted by {@link updateFrequencies}),
   * so only coordinates that appear solely in rows inserted after the
   * watermark are incremented. Coordinates are compared with `IS` so NULL
   * alleles behave like the GROUP BY in {@link recomputeAllFrequencies}.
   */
  updateFrequenciesForAppend(caseId: number, watermark: number): void {
    this.db
      .prepare(
        `
      INSERT INTO variant_frequency (chr, pos, ref, alt, case_count)
      SELECT DISTINCT n.chr, n.pos, n.ref, n.alt, 1
      FROM variants n
      WHERE n.case_id = ? AND n.id > ?
        AND NOT EXISTS (
          SELECT 1 FROM variants o
          WHERE o.case_id = n.case_id AND o.id <= ?
            AND o.chr IS n.chr AND o.pos IS n.pos AND o.ref IS n.ref AND o.alt IS n.alt
        )
      ON CONFLICT(chr, pos, ref, alt)
      DO UPDATE SET case_count = case_count + 1
    `
      )
      .run(caseId, watermark, watermark)
  }

  /**
   * Decrement variant_frequency counts for all variants in a case.
   * Called before case deletion. Removes rows where count reaches 0 unless
   * `prune` is false — batch callers decrement many cases and prune once.
   */
  decrementFrequencies(caseId: number, prune = true): void {
    this.db
      .prepare(
        `
      UPDATE variant_frequency
      SET case_count = case_count - 1
      WHERE (chr, pos, ref, alt) IN (
        SELECT DISTINCT chr, pos, ref, alt FROM variants WHERE case_id = ?
      )
    `
      )
      .run(caseId)
    if (prune) this.pruneZeroCounts()
  }

  /** Remove frequency rows whose case count dropped to zero. */
  pruneZeroCounts(): void {
    this.db.exec('DELETE FROM variant_frequency WHERE case_count <= 0')
  }

  /** Clear every frequency row (used when every case was deleted). */
  clearAll(): void {
    this.db.exec('DELETE FROM variant_frequency')
  }

  /**
   * Recompute all variant_frequency counts from scratch.
   * Used after bulk deletion operations where incremental updates aren't possible.
   * Counts published cases only: a case still being imported is counted by
   * {@link updateFrequencies} when it is published, not before.
   */
  recomputeAllFrequencies(): void {
    this.db.exec('DELETE FROM variant_frequency')
    this.db.exec(`
      INSERT INTO variant_frequency (chr, pos, ref, alt, case_count)
      SELECT v.chr, v.pos, v.ref, v.alt, COUNT(DISTINCT v.case_id)
      FROM variants v
      JOIN cases c ON c.id = v.case_id AND c.import_status = 'ready'
      GROUP BY v.chr, v.pos, v.ref, v.alt
    `)
  }
}
