/**
 * Incremental cohort-summary + FTS upkeep on case delete (audit 05, D-1)
 * must equal a full rebuild on the same remaining data.
 *
 * Seeded random cohorts (overlapping coordinates, two genome builds, mixed
 * genotypes, gene symbols and global annotations) are fully rebuilt, then
 * cases are deleted one by one through `deleteCasesIncrementally` with the
 * incremental remover — the delete worker's path. After every delete the
 * summary tables must match `rebuildCohortSummary` (the old full rebuild)
 * and the external-content FTS index must pass its integrity check.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  COHORT_FREQUENCY_SQL,
  COHORT_SUMMARY_WITH_FREQUENCY_FROM
} from '../../../src/main/database/cohort-frequency-sql'

import { DatabaseService } from '../../../src/main/database'
import {
  isCohortSummaryStale,
  openCaseSummaryRemoval
} from '../../../src/main/database/cohort-summary-case-removal'
import { deleteCasesIncrementally } from '../../../src/main/workers/delete-operations'
import { rebuildCohortSummary } from '../../../src/main/workers/worker-db'
import { rebuildCohortSummaryCancellable } from '../../../src/main/workers/cancellable-summary-rebuild'

function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const GTS = ['0/1', '1/1', '0|1', '1|1', './.', null]
const GENES = ['BRCA1', 'TTN', 'MYH7', '', null]

describe('incremental case removal equals a full cohort-summary rebuild', () => {
  let service: DatabaseService

  beforeEach(() => {
    service = new DatabaseService(':memory:')
  })

  afterEach(() => {
    service.close()
  })

  const db = (): DatabaseService['database'] => service.database

  /**
   * `uniform`: annotations derive from the coordinate (like one VEP run across
   * a cohort) with an occasional per-case deviation, which drives the
   * decrement-only path; random annotations drive the per-key recompute path.
   */
  function seed(next: () => number, caseCount: number, uniform = false): number[] {
    const insertCase = db().prepare(
      `INSERT INTO cases (name, file_path, file_size, variant_count, created_at, genome_build)
       VALUES (?, '/tmp/x.json', 1, 0, 0, ?)`
    )
    const insertVariant = db().prepare(
      `INSERT INTO variants (case_id, chr, pos, ref, alt, gene_symbol, consequence, func, gt_num,
         cadd, gnomad_af, omim_mim_number, variant_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    const ids: number[] = []
    for (let c = 0; c < caseCount; c++) {
      const build = next() < 0.75 ? 'GRCh38' : 'GRCh37'
      const id = Number(insertCase.run(`case-${c}`, build).lastInsertRowid)
      ids.push(id)
      const rows = 5 + Math.floor(next() * 30)
      for (let v = 0; v < rows; v++) {
        const pos = 100 + Math.floor(next() * 25) * 10
        const fixed = uniform && next() < 0.9
        const slot = pos / 10
        insertVariant.run(
          id,
          next() < 0.8 ? '1' : 'X',
          pos,
          'A',
          next() < 0.7 ? 'G' : 'T',
          fixed ? GENES[slot % GENES.length] : GENES[Math.floor(next() * GENES.length)],
          fixed ? 'HIGH' : next() < 0.5 ? 'HIGH' : 'MODERATE',
          fixed ? 'stop_gained' : next() < 0.5 ? 'missense_variant' : 'stop_gained',
          GTS[Math.floor(next() * GTS.length)],
          fixed ? slot : Math.round(next() * 400) / 10,
          fixed ? null : next() < 0.3 ? null : Math.round(next() * 1000) / 100000,
          fixed ? null : next() < 0.2 ? `${600000 + Math.floor(next() * 5)}` : null,
          next() < 0.9 ? 'snv' : 'sv'
        )
      }
    }
    const insertAnnotation = db().prepare(
      `INSERT OR IGNORE INTO variant_annotations
         (chr, pos, ref, alt, global_comment, starred, acmg_classification, created_at, updated_at)
       VALUES ('1', ?, 'A', 'G', ?, ?, ?, 0, 0)`
    )
    for (let i = 0; i < 6; i++) {
      insertAnnotation.run(
        100 + Math.floor(next() * 25) * 10,
        next() < 0.5 ? 'note' : null,
        next() < 0.5 ? 1 : 0,
        next() < 0.5 ? 'Pathogenic' : null
      )
    }
    return ids
  }

  function summarySnapshot(): { variants: unknown[]; genes: unknown[] } {
    return {
      variants: db()
        .prepare(
          // read_frequency: what readers show (the stored column is never written).
          `SELECT cvs.*, ${COHORT_FREQUENCY_SQL} AS read_frequency
           FROM ${COHORT_SUMMARY_WITH_FREQUENCY_FROM}
           ORDER BY chr, pos, ref, alt, variant_type, genome_build`
        )
        .all(),
      genes: (
        db()
          .prepare('SELECT * FROM gene_burden_summary ORDER BY gene_symbol, genome_build')
          .all() as Array<Record<string, unknown>>
      ).map((row) => {
        const rest = { ...row }
        delete rest.updated_at
        return rest
      })
    }
  }

  function expectFtsConsistent(): void {
    // External-content FTS5: rank 1 compares the index against `variants`.
    expect(() =>
      db().exec("INSERT INTO variants_fts(variants_fts, rank) VALUES('integrity-check', 1)")
    ).not.toThrow()
    const ftsRows = db().prepare('SELECT COUNT(*) AS c FROM variants_fts').get() as { c: number }
    const rows = db().prepare('SELECT COUNT(*) AS c FROM variants').get() as { c: number }
    expect(ftsRows.c).toBe(rows.c)
  }

  for (const seedValue of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const uniform = seedValue % 2 === 0
    it(`seed ${seedValue}${uniform ? ' (uniform annotations)' : ''}: every single-case delete matches the full rebuild`, async () => {
      const next = rng(seedValue)
      const ids = seed(next, 6, uniform)
      rebuildCohortSummary(db())
      expect(isCohortSummaryStale(db())).toBe(false)

      const order = [...ids].sort(() => next() - 0.5)
      for (const caseId of order) {
        const summary = openCaseSummaryRemoval(db())
        expect(summary).not.toBeNull()
        const result = await deleteCasesIncrementally(db(), [caseId], {
          deletingAll: false,
          summary,
          isCancelled: () => false,
          onProgress: () => undefined
        })
        expect(result.deleted).toBe(1)

        const incremental = summarySnapshot()
        rebuildCohortSummary(db())
        expect(incremental).toEqual(summarySnapshot())
        expectFtsConsistent()
      }
      expect(summarySnapshot()).toEqual({ variants: [], genes: [] })
    })
  }

  it('batch deletes stay equal to the full rebuild', async () => {
    const next = rng(42)
    const ids = seed(next, 8)
    rebuildCohortSummary(db())
    await deleteCasesIncrementally(db(), [ids[1], ids[4], ids[6]], {
      deletingAll: false,
      summary: openCaseSummaryRemoval(db()),
      isCancelled: () => false,
      onProgress: () => undefined
    })
    const incremental = summarySnapshot()
    rebuildCohortSummary(db())
    expect(incremental).toEqual(summarySnapshot())
    expectFtsConsistent()
  })

  it('declines to patch a stale summary (caller must fully rebuild)', () => {
    seed(rng(9), 2)
    db().exec("INSERT OR REPLACE INTO cohort_summary_meta (key, value) VALUES ('is_stale', '1')")
    expect(openCaseSummaryRemoval(db())).toBeNull()
  })

  it('the chunked cancellable rebuild produces the one-statement rebuild', async () => {
    seed(rng(11), 6)
    rebuildCohortSummary(db())
    const full = summarySnapshot()
    db().exec('DELETE FROM cohort_variant_summary; DELETE FROM gene_burden_summary')

    const outcome = await rebuildCohortSummaryCancellable(db(), () => false)
    expect(outcome).toBe('rebuilt')
    expect(summarySnapshot()).toEqual(full)
    expect(isCohortSummaryStale(db())).toBe(false)
  })

  it('a cancelled chunked rebuild rolls back and leaves the summary stale', async () => {
    seed(rng(12), 6)
    rebuildCohortSummary(db())
    const before = summarySnapshot()
    db().exec("INSERT OR REPLACE INTO cohort_summary_meta (key, value) VALUES ('is_stale', '1')")

    let chunks = 0
    const outcome = await rebuildCohortSummaryCancellable(
      db(),
      () => chunks >= 1,
      () => {
        chunks++
      }
    )
    expect(outcome).toBe('cancelled')
    expect(db().inTransaction).toBe(false)
    expect(summarySnapshot()).toEqual(before)
    expect(isCohortSummaryStale(db())).toBe(true)
  })
})
