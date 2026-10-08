/**
 * Exact cohort-summary upkeep for an edit of ONE variant row's annotation
 * (issue #461: a transcript switch rewrites gene_symbol / consequence / func /
 * cdna / aa_change / transcript).
 *
 * `cohort_variant_summary` shows, per coordinate, the annotation of its most
 * severe carrier row (#469, shared/sql/cohort-representative.ts) — the rule of
 * the full rebuild (`variantSummaryInsertSql`). An edited row may become that
 * row or stop being it, so the coordinate's rows are recomputed from
 * `variants` with the rebuild's own INSERT-SELECT restricted to that
 * coordinate, and its annotation flags re-derived the same way. Carrier counts
 * come out unchanged because the row set did not change.
 *
 * `gene_burden_summary`: when the gene changed, the old and the new gene are
 * recomputed with the rebuild's gene INSERT-SELECT restricted to them (served
 * by idx_variants_gene).
 *
 * Call inside the transaction that edits the variant. A stale or missing
 * summary is left alone: the pending full rebuild covers it. While an import
 * session is open the summary is not patched but flagged stale (see
 * {@link applyVariantAnnotationChange}); the session notices and rebuilds.
 */
import type { Database as DatabaseType } from 'better-sqlite3-multiple-ciphers'
import {
  CHECK_TABLE_EXISTS_SQL,
  MARK_STALE_SQL,
  TOUCH_SUMMARY_CONTENT_SQL,
  geneBurdenInsertSql,
  perCaseAnnotationFlagsSql,
  variantSummaryInsertSql
} from '../../shared/sql/cohort-summary-rebuild'
import { isImportSessionOpen } from './cohort-summary-case-add'
import { isCohortSummaryStale } from './cohort-summary-case-removal'

export interface SummaryCoordinate {
  chr: string
  pos: number
  ref: string
  alt: string
}

const AT_COORDINATE = `
      WHERE v.chr = @chr AND v.pos = @pos AND v.ref = @ref AND v.alt = @alt`

const DELETE_COORDINATE_SQL = `
  DELETE FROM cohort_variant_summary
  WHERE chr = @chr AND pos = @pos AND ref = @ref AND alt = @alt`

const DELETE_GENE_SQL = 'DELETE FROM gene_burden_summary WHERE gene_symbol = @gene'

const isCounted = (gene: string | null): gene is string => gene !== null && gene !== ''

/** True when the summary tables exist and are current, i.e. worth maintaining. */
export function isCohortSummaryMaintained(db: DatabaseType): boolean {
  const tables = db.prepare(CHECK_TABLE_EXISTS_SQL).get() as { c: number }
  return tables.c > 0 && !isCohortSummaryStale(db)
}

/** Recompute every summary row (all types and builds) of one coordinate. */
export function recomputeSummaryCoordinate(db: DatabaseType, coordinate: SummaryCoordinate): void {
  const at = { chr: coordinate.chr, pos: coordinate.pos, ref: coordinate.ref, alt: coordinate.alt }
  db.prepare(DELETE_COORDINATE_SQL).run(at)
  db.prepare(variantSummaryInsertSql(AT_COORDINATE)).run(at)
  db.prepare(perCaseAnnotationFlagsSql(AT_COORDINATE)).run(at)
  db.exec(TOUCH_SUMMARY_CONTENT_SQL)
}

/** Recompute the gene-burden rows (all builds) of the given genes. */
export function recomputeGeneBurden(db: DatabaseType, genes: Iterable<string | null>): void {
  const remove = db.prepare(DELETE_GENE_SQL)
  const insert = db.prepare(geneBurdenInsertSql(' AND v.gene_symbol = @gene'))
  for (const gene of new Set(genes)) {
    if (!isCounted(gene)) continue
    remove.run({ gene })
    insert.run({ gene })
  }
}

/**
 * A variant row at `coordinate` had its annotation rewritten; its gene went
 * from `geneBefore` to `geneAfter`. Returns true when the summary could not
 * be patched and was flagged stale instead: the caller owes the renderer a
 * cohort-stale event, since nobody else will send one for this edit.
 */
export function applyVariantAnnotationChange(
  db: DatabaseType,
  coordinate: SummaryCoordinate,
  geneBefore: string | null,
  geneAfter: string | null
): boolean {
  if (!isCohortSummaryMaintained(db)) return false
  if (isImportSessionOpen(db)) {
    // An import session is writing (or died writing). Recomputing here would
    // (a) count the carriers of a half-inserted case, which the session then
    // adds a second time, and (b) scan `variants` on this — the Electron main
    // — thread, because a bulk import drops the coordinate and gene indexes.
    // Building the index first would be the same scan plus a sort, so the edit
    // is O(1) instead: flag the summary and let the session rebuild at its end.
    db.exec(MARK_STALE_SQL)
    return true
  }
  recomputeSummaryCoordinate(db, coordinate)
  if (geneBefore !== geneAfter) recomputeGeneBurden(db, [geneBefore, geneAfter])
  return false
}
