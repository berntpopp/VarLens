/**
 * Exact per-file cohort-summary upkeep for an import session.
 *
 * A bulk import used to mark `cohort_variant_summary` / `gene_burden_summary`
 * stale for the whole session and rebuild both from every variant at the end.
 * This keeps both tables equal to a full rebuild after EVERY imported case, so
 * the cohort view is right as soon as a file is done:
 *
 *  - add: one transaction per case, driven only by that case's rows
 *    (cohort-summary-case-add-sql.ts) — carrier/het/hom += the case's deduped
 *    contribution, MAX columns merged NULL-safely, new rows flagged from
 *    variant_annotations, per-case annotation flags re-applied; gene burden
 *    += the case's rows, 1 case, and the coordinates no other case has for
 *    that gene and build.
 *  - replace (overwrite of an existing case): the old case's contribution is
 *    removed exactly, atomically with its deletion, by the case-removal module
 *    (cohort-summary-case-removal.ts) plus a flag recompute at the coordinates
 *    its per-case annotations touched.
 *
 * State (`cohort_summary_meta`): `is_stale` stays 0 throughout — readers may
 * use the summary mid-session. `import_session_open` is set while a session
 * runs and cleared by {@link ImportSummarySession.finish}; a session that dies
 * leaves it behind, and both the next session and the app start
 * (`DatabaseService.needsStartupRebuild`) then rebuild. A summary that is
 * stale or interrupted at session start is flagged stale and rebuilt once
 * before the first file; if that rebuild fails the flag stays and the session
 * is not exact.
 * Any failure falls back to the old behaviour: mark stale, rebuild at the end
 * — and so does a session whose remaining files are cheaper to rebuild once
 * than to merge one by one ({@link UpkeepPolicy}).
 *
 * Exactness is asserted against the full rebuild after every file by
 * `tests/main/workers/import-worker-summary-drift.test.ts`.
 *
 * Runs inside worker threads: no MainLogger / Electron imports.
 */
import type { Database as DatabaseType } from 'better-sqlite3-multiple-ciphers'
import {
  CHECK_TABLE_EXISTS_SQL,
  MARK_STALE_SQL,
  UPDATE_PER_CASE_ANNOTATION_FLAGS_SQL
} from '../../shared/sql/cohort-summary-rebuild'
import {
  isCohortSummaryStale,
  openCaseSummaryRemoval,
  type CaseSummaryRemoval
} from './cohort-summary-case-removal'
import * as sql from './cohort-summary-case-add-sql'
import { countAddedCaseUniqueVariants } from './cohort-unique-variant-count'

export interface ImportSummarySession {
  /** False once incremental upkeep was abandoned; `finish` then rebuilds. */
  isExact(): boolean
  /** Delete a case about to be re-imported, removing its summary contribution. */
  replaceCase(caseId: number, deleteCase: () => void): void
  /**
   * Merge a fully imported, committed case into both summary tables.
   * `filesAfterThis`: files of the session still to come (see {@link UpkeepPolicy}).
   */
  addCase(caseId: number, filesAfterThis?: number): void
  /** Orderly session end: rebuild if upkeep was abandoned, ANALYZE, clear the marker. */
  finish(): void
}

/**
 * When per-file upkeep stops paying for itself.
 *
 * Merging one file rewrites the summary pages its variants land on, which for
 * exome-sized files is most of the table and of every index on it, so the cost
 * per file grows with the summary (measured: 0.3 s at 60,000 rows, 0.85 s at
 * 337,000, 1.7 s at 845,000 — about a third of the per-variant cost again for
 * every summary row). One rebuild at the end costs about as much per variant
 * in the database as a merge costs per imported variant. The remaining files
 * are therefore cheaper to merge than to rebuild for exactly as long as
 *
 *     filesLeft * summaryRows <= costRatio * variantsInDatabase
 *
 * which holds for a few files into a large database (1 file into 100 exomes:
 * 1.7 s instead of a 31 s rebuild) and fails for a long batch into a small or
 * empty one — there the session falls back to the single rebuild at its end,
 * so a batch is not slower than it was before per-file upkeep existed.
 * Summaries below `minSummaryRows` are always merged: too cheap to matter.
 */
export interface UpkeepPolicy {
  minSummaryRows: number
  costRatio: number
}

export const DEFAULT_UPKEEP_POLICY: UpkeepPolicy = { minSummaryRows: 50_000, costRatio: 3 }

export interface ImportSummarySessionOptions {
  /** Defaults to {@link DEFAULT_UPKEEP_POLICY}. */
  upkeepPolicy?: UpkeepPolicy
  /** Rebuild before the first file even if the summary claims to be current. */
  forceRebuild: boolean
  /** Full rebuild of both tables; must leave `is_stale = 0` on success. */
  rebuild: () => void
  onWarning: (message: string) => void
}

/** True when an import session did not reach its orderly end. */
export function isImportSessionOpen(db: DatabaseType): boolean {
  return db.prepare(sql.IS_IMPORT_SESSION_OPEN_SQL).get() !== undefined
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/** Pre-v13 database without summary tables: nothing to maintain. */
const NO_SUMMARY: ImportSummarySession = {
  isExact: () => false,
  replaceCase: (_caseId, deleteCase) => deleteCase(),
  addCase: () => undefined,
  finish: () => undefined
}

export function openImportSummarySession(
  db: DatabaseType,
  options: ImportSummarySessionOptions
): ImportSummarySession {
  const tables = db.prepare(CHECK_TABLE_EXISTS_SQL).get() as { c: number }
  if (tables.c === 0) return NO_SUMMARY

  let exact = false
  const degrade = (step: string, e: unknown): void => {
    exact = false
    options.onWarning(
      `Cohort summary upkeep failed (${step}); rebuilding at session end: ${message(e)}`
    )
    try {
      db.exec(MARK_STALE_SQL)
    } catch {
      // the open-session marker still forces a rebuild
    }
  }

  let stmts: ReturnType<typeof prepareAddStatements> | undefined
  try {
    if (options.forceRebuild || isCohortSummaryStale(db) || isImportSessionOpen(db)) {
      // Flag first: `rebuild` reports nothing, and only a rebuild that ran to
      // its end clears the flag. A failed one must not pass for a current base.
      db.exec(MARK_STALE_SQL)
      options.rebuild()
    }
    db.exec(sql.SET_IMPORT_SESSION_OPEN_SQL)
    db.exec(sql.CASE_ADD_TEMP_TABLES_SQL)
    stmts = prepareAddStatements(db)
    exact = !isCohortSummaryStale(db)
  } catch (e) {
    degrade('session start', e)
  }

  let removal: CaseSummaryRemoval | null = null
  const applyPerCaseFlags = (): void => {
    if (stmts?.hasPerCaseAnnotations.get() !== undefined)
      db.exec(UPDATE_PER_CASE_ANNOTATION_FLAGS_SQL)
  }

  const policy = options.upkeepPolicy ?? DEFAULT_UPKEEP_POLICY
  const rebuildIsCheaper = (s: NonNullable<typeof stmts>, filesLeft: number): boolean => {
    const summaryRows = (s.countSummaryRows.get() as { c: number }).c
    if (summaryRows < policy.minSummaryRows) return false
    const variants = (s.countVariants.get() as { c: number }).c
    return filesLeft * summaryRows > policy.costRatio * variants
  }

  return {
    isExact: () => exact,

    replaceCase(caseId, deleteCase) {
      if (exact && stmts) {
        const s = stmts
        try {
          // The removal looks other carriers up by coordinate.
          db.exec(sql.ENSURE_COORD_INDEX_SQL)
          removal ??= openCaseSummaryRemoval(db)
          if (!removal) throw new Error('summary is stale')
          const remover = removal
          db.transaction(() => {
            db.exec('DELETE FROM temp.replaced_case_flag_coords')
            s.captureReplacedFlagCoords.run(caseId)
            remover.beforeDelete(caseId)
            deleteCase()
            remover.afterDelete()
            s.resetReplacedFlags.run()
            applyPerCaseFlags()
          })()
          return
        } catch (e) {
          degrade('replace case', e)
        }
      }
      deleteCase()
    },

    addCase(caseId, filesAfterThis = 0) {
      if (!exact || !stmts) {
        db.prepare("UPDATE cases SET import_status = 'ready' WHERE id = ?").run(caseId)
        return
      }
      const s = stmts
      try {
        if (rebuildIsCheaper(s, filesAfterThis + 1)) {
          // Not a failure: no warning. `finish` rebuilds once.
          // The case is published together with the stale flag, so the
          // rebuild at session end (ready cases only) includes it.
          exact = false
          db.transaction(() => {
            db.exec(MARK_STALE_SQL)
            s.markCaseReady.run(caseId)
          })()
          return
        }
        db.transaction(() => {
          const row = s.caseBuild.get(caseId) as { genome_build: string | null } | undefined
          if (row?.genome_build == null) throw new Error(`case ${caseId} has no genome build`)
          const params = { caseId, build: row.genome_build }
          db.exec('DELETE FROM temp.added_case_gene_coords')
          // Gene pairs first: they are classified against the summary as it
          // was before this case joined it.
          s.captureGeneCoords.run(params)
          if ((s.countUnresolved.get() as { c: number }).c > 0) {
            db.exec(sql.ENSURE_COORD_INDEX_SQL)
            s.resolveGeneCoords.run(params)
          }
          s.upsertGeneBurden.run({ build: params.build })
          db.exec('DELETE FROM temp.added_case_coords')
          s.captureCaseCoords.run(params)
          countAddedCaseUniqueVariants(db) // before the new rows exist
          s.incrementCarriers.run()
          s.mergeVariantMaxima.run()
          s.insertNewVariantSummary.run({ build: params.build })
          applyPerCaseFlags()
          s.markCaseReady.run(caseId)
        })()
      } catch (e) {
        degrade('add case', e)
      }
    },

    finish() {
      try {
        if (!exact) options.rebuild()
        else {
          db.exec('ANALYZE cohort_variant_summary')
          db.exec('ANALYZE gene_burden_summary')
        }
        if (!isCohortSummaryStale(db)) db.exec(sql.CLEAR_IMPORT_SESSION_OPEN_SQL)
      } catch (e) {
        options.onWarning(`Failed to finish cohort summary upkeep: ${message(e)}`)
      }
    }
  }
}

function prepareAddStatements(db: DatabaseType) {
  return {
    caseBuild: db.prepare('SELECT genome_build FROM cases WHERE id = ?'),
    markCaseReady: db.prepare("UPDATE cases SET import_status = 'ready' WHERE id = ?"),
    countSummaryRows: db.prepare('SELECT COUNT(*) AS c FROM cohort_variant_summary'),
    countVariants: db.prepare('SELECT COALESCE(SUM(variant_count), 0) AS c FROM cases'),
    captureGeneCoords: db.prepare(sql.CAPTURE_GENE_COORDS_SQL),
    countUnresolved: db.prepare(sql.COUNT_UNRESOLVED_GENE_COORDS_SQL),
    resolveGeneCoords: db.prepare(sql.RESOLVE_GENE_COORDS_SQL),
    upsertGeneBurden: db.prepare(sql.UPSERT_GENE_BURDEN_SQL),
    incrementCarriers: db.prepare(sql.INCREMENT_CARRIERS_SQL),
    captureCaseCoords: db.prepare(sql.CAPTURE_CASE_COORDS_SQL),
    mergeVariantMaxima: db.prepare(sql.MERGE_VARIANT_MAXIMA_SQL),
    insertNewVariantSummary: db.prepare(sql.INSERT_NEW_VARIANT_SUMMARY_SQL),
    captureReplacedFlagCoords: db.prepare(sql.CAPTURE_REPLACED_FLAG_COORDS_SQL),
    resetReplacedFlags: db.prepare(sql.RESET_REPLACED_FLAGS_SQL),
    hasPerCaseAnnotations: db.prepare(sql.HAS_PER_CASE_ANNOTATIONS_SQL)
  }
}
