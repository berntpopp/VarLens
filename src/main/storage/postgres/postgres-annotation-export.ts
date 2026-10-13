/**
 * PostgreSQL: the annotation cells of exported rows (#574; SQLite twin
 * database/annotation-export-lookup.ts). The export query streams on one
 * connection, so the annotations come along in its select list (correlated
 * lookups, which keep its order) instead of from a second query.
 */
import {
  caseExportCells,
  cohortExportCells,
  type ExportedAnnotation
} from '../../../shared/acmg/annotation-export'

type Row = Record<string, unknown>

const CALL = (alias: string, comment: string): string => `jsonb_build_object(
    'acmg_classification', ${alias}.acmg_classification, 'acmg_evidence', ${alias}.acmg_evidence,
    'comment', ${alias}.${comment})`

/** Select-list entries of a case export (variants aliased `v`). */
export function caseAnnotationExportColumns(schemaName: string): string {
  return `(SELECT ${CALL('cva', 'per_case_comment')}
       FROM ${schemaName}."case_variant_annotations" cva
      WHERE cva.case_id = v.case_id AND cva.variant_id = v.id) AS __own_annotation,
    (SELECT ${CALL('va', 'global_comment')}
       FROM ${schemaName}."variant_annotations" va
       JOIN ${schemaName}."cases_all" c ON c.id = v.case_id
      WHERE va.chr = v.chr AND va.pos = v.pos AND va.ref = v.ref AND va.alt = v.alt
        AND va.genome_build = c.genome_build) AS __global_annotation`
}

/** Select-list entry of a cohort export (summary aliased `cvs`). */
export function cohortAnnotationExportColumns(schemaName: string): string {
  return `(SELECT ${CALL('va', 'global_comment')}
       FROM ${schemaName}."variant_annotations" va
      WHERE va.chr = cvs.chr AND va.pos = cvs.pos AND va.ref = cvs.ref AND va.alt = cvs.alt
        AND va.genome_build = cvs.genome_build) AS __global_annotation`
}

/** Replace the looked-up annotations by the export cells of the scope. */
export async function* withAnnotationCells(
  rows: AsyncIterable<Row>,
  scope: 'case' | 'cohort'
): AsyncGenerator<Row> {
  for await (const row of rows) {
    const { __own_annotation, __global_annotation, ...rest } = row
    const own = (__own_annotation ?? null) as ExportedAnnotation | null
    const global = (__global_annotation ?? null) as ExportedAnnotation | null
    yield {
      ...rest,
      ...(scope === 'case' ? caseExportCells(own, global) : cohortExportCells(global))
    }
  }
}
