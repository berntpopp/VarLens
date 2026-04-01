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
   * Decrement variant_frequency counts for all variants in a case.
   * Called before case deletion. Removes rows where count reaches 0.
   */
  decrementFrequencies(caseId: number): void {
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
    this.db.exec('DELETE FROM variant_frequency WHERE case_count <= 0')
  }

  /**
   * Recompute all variant_frequency counts from scratch.
   * Used after bulk deletion operations where incremental updates aren't possible.
   */
  recomputeAllFrequencies(): void {
    this.db.exec('DELETE FROM variant_frequency')
    this.db.exec(`
      INSERT INTO variant_frequency (chr, pos, ref, alt, case_count)
      SELECT chr, pos, ref, alt, COUNT(DISTINCT case_id)
      FROM variants GROUP BY chr, pos, ref, alt
    `)
  }
}
