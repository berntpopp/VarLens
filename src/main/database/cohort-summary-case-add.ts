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
 * stale or interrupted at session start is rebuilt once before the first file.
 * Any failure falls back to the old behaviour: mark stale, rebuild at the end.
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

export interface ImportSummarySession {
  /** False once incremental upkeep was abandoned; `finish` then rebuilds. */
  isExact(): boolean
  /** Delete a case about to be re-imported, removing its summary contribution. */
  replaceCase(caseId: number, deleteCase: () => void): void
  /** Merge a fully imported, committed case into both summary tables. */
  addCase(caseId: number): void
  /** Orderly session end: rebuild if upkeep was abandoned, ANALYZE, clear the marker. */
  finish(): void
}

export interface ImportSummarySessionOptions {
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

    addCase(caseId) {
      if (!exact || !stmts) return
      const s = stmts
      try {
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
          s.incrementCarriers.run()
          s.mergeVariantMaxima.run()
          s.insertNewVariantSummary.run({ build: params.build })
          applyPerCaseFlags()
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
