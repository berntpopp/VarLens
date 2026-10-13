/**
 * SQLite: the annotation cells of exported rows (#574; PG twin
 * storage/postgres/postgres-annotation-export.ts). Indexed lookups per row,
 * inside the export worker's read-only connection.
 */
import type { Database as DatabaseType } from 'better-sqlite3-multiple-ciphers'

import {
  caseExportCells,
  cohortExportCells,
  type ExportedAnnotation
} from '../../shared/acmg/annotation-export'

type Row = Record<string, unknown>

/** The global row of a coordinate; the build expression completes it. */
const GLOBAL_AT = `SELECT acmg_classification, acmg_evidence, global_comment AS comment
  FROM variant_annotations
  WHERE chr = ? AND pos = ? AND ref = ? AND alt = ? AND genome_build =`

/** Case export: the case's own call and comment, and the global comment of its build. */
export function caseRowAnnotations(
  db: DatabaseType
): (row: Row) => ReturnType<typeof caseExportCells> {
  const perCase = db.prepare(
    `SELECT acmg_classification, acmg_evidence, per_case_comment AS comment
       FROM case_variant_annotations WHERE case_id = ? AND variant_id = ?`
  )
  const global = db.prepare(`${GLOBAL_AT} (SELECT genome_build FROM cases WHERE id = ?)`)
  return (row) => {
    const own = perCase.get(row.case_id, row.id) as ExportedAnnotation | undefined
    const shared = global.get(row.chr, row.pos, row.ref, row.alt, row.case_id) as
      ExportedAnnotation | undefined
    return caseExportCells(own ?? null, shared ?? null)
  }
}

/** Cohort export: the global call and comment of the row's build. */
export function cohortRowAnnotations(
  db: DatabaseType
): (row: {
  chr: string
  pos: number
  ref: string
  alt: string
  genome_build: string
}) => ReturnType<typeof cohortExportCells> {
  const global = db.prepare(`${GLOBAL_AT} ?`)
  return (row) =>
    cohortExportCells(
      (global.get(row.chr, row.pos, row.ref, row.alt, row.genome_build) as
        ExportedAnnotation | undefined) ?? null
    )
}
