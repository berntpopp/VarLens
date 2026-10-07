/**
 * Full cohort-summary rebuild that can be cancelled part-way (audit 05, D-1).
 *
 * The one-statement rebuild (`rebuildCohortSummary` in worker-db.ts) cannot be
 * interrupted once it starts. This variant rebuilds chromosome by chromosome
 * inside one explicit transaction and yields to the worker event loop between
 * chromosomes, so a `cancel` message is observed within one chromosome's
 * worth of work. A cancel rolls the whole rebuild back: the previous summary
 * rows stay, still flagged `is_stale = '1'`, and the next rebuild recomputes
 * them. The produced rows are identical to the one-statement rebuild because
 * both use `variantSummaryInsertSql` / `geneBurdenInsertSql`.
 *
 * Worker-thread module: no MainLogger / Electron imports.
 */
import type { Database as DatabaseType } from 'better-sqlite3-multiple-ciphers'
import {
  CHECK_TABLE_EXISTS_SQL,
  REBUILD_GENE_BURDEN_SQL,
  UPDATE_PER_CASE_ANNOTATION_FLAGS_SQL,
  UPDATE_META_SQL,
  variantSummaryInsertSql
} from '../../shared/sql/cohort-summary-rebuild'

const yieldToEventLoop = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

export type SummaryRebuildOutcome = 'rebuilt' | 'cancelled' | 'skipped'

/**
 * @param isCancelled polled between chromosomes
 * @param onChunk     called after each chromosome with (done, total)
 */
export async function rebuildCohortSummaryCancellable(
  db: DatabaseType,
  isCancelled: () => boolean,
  onChunk: (done: number, total: number) => void = () => undefined
): Promise<SummaryRebuildOutcome> {
  const exists = db.prepare(CHECK_TABLE_EXISTS_SQL).get() as { c: number }
  if (exists.c === 0) return 'skipped'
  if (isCancelled()) return 'cancelled'

  const chromosomes = (
    db.prepare('SELECT DISTINCT chr FROM variants ORDER BY chr').all() as { chr: string }[]
  ).map((row) => row.chr)
  const insertChromosome = db.prepare(variantSummaryInsertSql('\n      WHERE v.chr = ?'))

  db.exec('BEGIN IMMEDIATE')
  try {
    db.exec('DELETE FROM cohort_variant_summary')
    for (const [index, chr] of chromosomes.entries()) {
      insertChromosome.run(chr)
      onChunk(index + 1, chromosomes.length)
      await yieldToEventLoop()
      if (isCancelled()) {
        db.exec('ROLLBACK')
        return 'cancelled'
      }
    }
    // Per-case stars/comments/ACMG calls, as CohortSummaryService.rebuild() does.
    db.exec(UPDATE_PER_CASE_ANNOTATION_FLAGS_SQL)
    db.exec(REBUILD_GENE_BURDEN_SQL)
    db.exec(UPDATE_META_SQL)
    db.exec('COMMIT')
  } catch (error) {
    if (db.inTransaction) db.exec('ROLLBACK')
    throw error
  }

  for (const table of ['cohort_variant_summary', 'gene_burden_summary']) {
    try {
      db.exec(`ANALYZE ${table}`)
    } catch (e) {
      console.warn(
        `[summary-rebuild] Failed to ANALYZE ${table}:`,
        e instanceof Error ? e.message : String(e)
      )
    }
  }
  return 'rebuilt'
}
