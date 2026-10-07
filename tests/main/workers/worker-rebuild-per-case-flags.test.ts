// @vitest-environment node
/**
 * Per-case stars / comments / ACMG calls (case_variant_annotations) feed the
 * summary's has_star / has_comment / acmg_best — the annotation triggers and
 * CohortSummaryService.rebuild() maintain them. The worker-side rebuilds used
 * to skip that step, so a batch import or case delete silently cleared them.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3-multiple-ciphers'
import type { Database as DatabaseType } from 'better-sqlite3-multiple-ciphers'

import { initializeSchema } from '../../../src/main/database/schema'
import { runMigrations } from '../../../src/main/database/migrations'
import { rebuildCohortSummary } from '../../../src/main/workers/worker-db'
import { rebuildCohortSummaryCancellable } from '../../../src/main/workers/cancellable-summary-rebuild'
import { referenceSummary, snapshotSummary } from './support/summary-reference'

describe('worker cohort-summary rebuilds keep per-case annotation flags', () => {
  let db: DatabaseType

  beforeEach(() => {
    db = new Database(':memory:')
    initializeSchema(db)
    runMigrations(db)
    const now = Date.now()
    db.exec(`
      INSERT INTO cases (id, name, file_path, file_size, created_at, genome_build)
        VALUES (1, 'A', '/a', 1, ${now}, 'GRCh38'), (2, 'B', '/b', 1, ${now}, 'GRCh38');
      INSERT INTO variants (id, case_id, chr, pos, ref, alt, gene_symbol, gt_num)
        VALUES (1, 1, 'chr1', 100, 'A', 'G', 'AAA', '0/1'),
               (2, 2, 'chr1', 100, 'A', 'G', 'AAA', '1/1'),
               (3, 2, 'chr2', 200, 'C', 'T', 'BBB', '0/1');
      INSERT INTO case_variant_annotations
        (case_id, variant_id, per_case_comment, starred, acmg_classification, created_at, updated_at)
        VALUES (1, 1, 'note', 1, 'Likely pathogenic', ${now}, ${now});
      DELETE FROM cohort_variant_summary;
    `)
  })

  afterEach(() => db.close())

  const flagged = { pos: 100, has_star: 1, has_comment: 1, acmg_best: 'Likely pathogenic' }
  const unflagged = { pos: 200, has_star: 0, has_comment: 0, acmg_best: null }

  it('rebuildCohortSummary (import worker)', () => {
    rebuildCohortSummary(db)
    const summary = snapshotSummary(db)
    expect(summary.variants).toEqual([
      expect.objectContaining(flagged),
      expect.objectContaining(unflagged)
    ])
    expect(summary).toEqual(referenceSummary(db))
  })

  it('rebuildCohortSummaryCancellable (delete worker)', async () => {
    expect(await rebuildCohortSummaryCancellable(db, () => false)).toBe('rebuilt')
    const summary = snapshotSummary(db)
    expect(summary.variants).toEqual([
      expect.objectContaining(flagged),
      expect.objectContaining(unflagged)
    ])
    expect(summary).toEqual(referenceSummary(db))
  })
})
