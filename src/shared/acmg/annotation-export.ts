/**
 * The annotation cells of one exported row (#574), computed the same way for
 * every backend and format from the annotation rows the row has.
 */
import { acmgEvidenceFields } from './acmg-evidence'

/** A stored annotation row as the exports read it. */
export interface ExportedAnnotation {
  acmg_classification: string | null
  acmg_evidence: string | null
  comment: string | null
}

interface AcmgCells {
  acmg_classification: string | null
  acmg_points: number | null
  acmg_override_reason: string | null
}

function acmgCells(call: ExportedAnnotation | null): AcmgCells {
  const { points, overrideReason } = acmgEvidenceFields(call?.acmg_evidence)
  return {
    acmg_classification: call?.acmg_classification ?? null,
    acmg_points: points,
    acmg_override_reason: overrideReason
  }
}

/** Case export: the case's own call, its comment and the global comment of its build. */
export function caseExportCells(
  own: ExportedAnnotation | null,
  global: ExportedAnnotation | null
): AcmgCells & { case_comment: string | null; global_comment: string | null } {
  return { ...acmgCells(own), case_comment: own?.comment ?? null, global_comment: global?.comment ?? null }
}

/** Cohort export: the global call and comment of the row's build. */
export function cohortExportCells(
  global: ExportedAnnotation | null
): AcmgCells & { global_comment: string | null } {
  return { ...acmgCells(global), global_comment: global?.comment ?? null }
}
