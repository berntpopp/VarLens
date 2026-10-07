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
 * runs and cleared by {@link ImportSummarySession.finish} or by any completed
 * full rebuild (UPDATE_META_SQL); the session re-asserts it with every insert
 * transaction. A session that dies leaves it behind, and both the next session
 * and the app start (`DatabaseService.needsStartupRebuild`) then rebuild. A summary that is
 * stale or interrupted at session start is flagged stale and rebuilt once
 * before the first file; if that rebuild fails the flag stays and the session
 * is not exact.
 * Writers outside the session (insert batches commit one by one, so they see
 * a half-inserted case) can therefore not make the session count it twice:
 *  - incremental writers never patch the summary while the marker is set —
 *    they flag it stale instead (transcript switch:
 *    cohort-summary-coordinate-recompute.ts; case delete:
 *    `openSummaryRemovalForDelete`, which falls back to a full rebuild); the
 *    session sees the flag in its next merge transaction and stops merging;
 *  - a full rebuild clears the marker, which the session notices in its next
 *    write transaction (`keepSessionOpen`): it flags the summary stale again
 *    and stops merging.
 * In both cases one rebuild at the session's end restores exactness, and a
 * session that dies first leaves the stale flag or the marker behind.
 * Any failure falls back to the old behaviour: mark stale, rebuild at the end
 * — and so does a session whose remaining files are cheaper to rebuild once
 * than to merge one by one ({@link UpkeepPolicy}).
 *
 * Publication (`cases.import_status`, migration v40): the pipeline inserts a
 * case 'provisional' and every reader sees 'ready' cases only. `addCase` flips
 * it in the transaction that merges it — or, when there is no merge, in one
 * that flags the summary stale — so a ready case is never missing from a
 * summary that claims to be current, and a successfully imported case is never
 * left provisional (`tests/main/database/cohort-summary-publication.test.ts`).
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
   * Publish a fully imported, committed case: merge it into both summary
   * tables and flip it from 'provisional' to 'ready' in one transaction. When
   * the merge is not possible (upkeep abandoned, skipped by policy, or it
   * throws) the case is published together with the stale flag instead, so
   * the rebuild at session end — which reads ready cases only — includes it.
   * Returns with the case ready, or throws with it still provisional (the
   * caller then deletes it). Nests as a savepoint inside a caller's
   * transaction, which must then be IMMEDIATE.
   * `filesAfterThis`: files of the session still to come (see {@link UpkeepPolicy}).
   */
  addCase(caseId: number, filesAfterThis?: number): void
  /**
   * Delete a case of this session that never reached {@link addCase}
   * (cancelled or failed mid-file). Its rows are in no summary the session
   * wrote, but a full rebuild from outside may have counted them: that is
   * detected here, in the delete's transaction.
   */
  discardCase(deleteCase: () => void): void
  /**
   * Call inside every transaction that inserts variants. A full rebuild from
   * outside the session clears the open-session marker; this puts it back
   * together with the rows that rebuild did not see — and, because such a
   * rebuild counted whatever part of the current case was committed, flags
   * the summary stale and ends incremental upkeep for the session.
   */
  keepSessionOpen(): void
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
  /**
   * The session stopped keeping the summary current (it is flagged stale until
   * `finish` rebuilds). Called at most once, before the file that made it so
   * is reported done.
   */
  onStale?: () => void
}

/** True when an import session did not reach its orderly end. */
export function isImportSessionOpen(db: DatabaseType): boolean {
  return db.prepare(sql.IS_IMPORT_SESSION_OPEN_SQL).get() !== undefined
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e))

const MARK_CASE_READY_SQL = "UPDATE cases SET import_status = 'ready' WHERE id = ?"

/** Pre-v13 database without summary tables: nothing to maintain, cases still publish. */
const noSummarySession = (db: DatabaseType): ImportSummarySession => ({
  isExact: () => false,
  replaceCase: (_caseId, deleteCase) => deleteCase(),
  addCase: (caseId) => void db.prepare(MARK_CASE_READY_SQL).run(caseId),
  discardCase: (deleteCase) => deleteCase(),
  keepSessionOpen: () => undefined,
  finish: () => undefined
})

export function openImportSummarySession(
  db: DatabaseType,
  options: ImportSummarySessionOptions
): ImportSummarySession {
  const tables = db.prepare(CHECK_TABLE_EXISTS_SQL).get() as { c: number }
  if (tables.c === 0) return noSummarySession(db)

  let exact = false
  let staleAnnounced = false
  /** Incremental upkeep is over for this session; say so once. */
  const abandon = (): void => {
    exact = false
    if (staleAnnounced) return
    staleAnnounced = true
    options.onStale?.()
  }
  const degrade = (step: string, e: unknown): void => {
    abandon()
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
    if (!exact) abandon()
  } catch (e) {
    degrade('session start', e)
  }

  /**
   * Must run inside a write transaction. The marker is only ever removed by a
   * completed full rebuild (UPDATE_META_SQL), so finding it gone means one ran
   * since the session's last write. That rebuild saw the committed part of the
   * case in flight and reported the summary current: merging the case would
   * count it twice, deleting it would leave a phantom carrier. Either way the
   * summary is flagged again, atomically with the write that makes it wrong.
   */
  const keepSessionOpen = (): void => {
    if (!stmts || stmts.keepSessionOpen.run().changes === 0) return
    db.exec(MARK_STALE_SQL)
    if (!exact) return
    abandon()
    options.onWarning(
      'Cohort summary was rebuilt outside the import session; rebuilding at session end'
    )
  }

  let removal: CaseSummaryRemoval | null = null
  const applyPerCaseFlags = (): void => {
    if (stmts?.hasPerCaseAnnotations.get() !== undefined)
      db.exec(UPDATE_PER_CASE_ANNOTATION_FLAGS_SQL)
  }

  /**
   * Publish a case the summary does not contain: the stale flag and the case
   * become visible in the same transaction, so no reader ever sees a ready
   * case missing from a summary that claims to be current.
   */
  const publishStale = (caseId: number): void => {
    db.transaction(() => {
      db.exec(MARK_STALE_SQL)
      db.prepare(MARK_CASE_READY_SQL).run(caseId)
    }).immediate()
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
      if (exact && stmts) {
        const s = stmts
        try {
          if (rebuildIsCheaper(s, filesAfterThis + 1)) {
            // Not a failure: no warning. `finish` rebuilds once.
            publishStale(caseId)
            abandon()
            return
          }
          // IMMEDIATE: the staleness check below must not be a snapshot older
          // than the write lock.
          db.transaction(() => {
            keepSessionOpen()
            if (isCohortSummaryStale(db)) {
              // Flagged from outside the session (an edit that could not patch
              // the summary while files are in flight): stop merging onto it.
              // Already stale, so the case is published as it is.
              s.markCaseReady.run(caseId)
              abandon()
              return
            }
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
          }).immediate()
          return
        } catch (e) {
          degrade('add case', e)
        }
      }
      // No merge (abandoned earlier, or it just failed and rolled back): the
      // imported case is still published. A throw here leaves it provisional.
      publishStale(caseId)
    },

    discardCase(deleteCase) {
      if (!stmts) return deleteCase()
      db.transaction(() => {
        keepSessionOpen()
        deleteCase()
      }).immediate()
    },

    keepSessionOpen,

    finish() {
      try {
        // Stale without `exact` having dropped: flagged after the last file
        // by an edit outside the session, which told the renderer "stale".
        // Announce it here too, so the import reports "current" afterwards.
        if (exact && isCohortSummaryStale(db)) abandon()
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
    keepSessionOpen: db.prepare(sql.KEEP_IMPORT_SESSION_OPEN_SQL),
    caseBuild: db.prepare('SELECT genome_build FROM cases WHERE id = ?'),
    markCaseReady: db.prepare(MARK_CASE_READY_SQL),
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
