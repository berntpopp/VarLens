/**
 * The annotation cells of one exported row (#574), computed the same way for
 * every backend and format from the annotation rows the row has.
 */
import { acmgEvidenceFields } from './acmg-evidence'

/** The ACMG call the row exports: per-case in a case export, global in a cohort export. */
export interface ExportedClassification {
  acmg_classification: string | null
  acmg_evidence: string | null
}

/** A comment the details panel shows for the row, with its row's last update. */
export interface ExportedComment {
  comment: string | null
  updated_at: number
}

export interface AnnotationExportCells {
  acmg_classification: string | null
  acmg_points: number | null
  acmg_override_reason: string | null
  annotation_comment: string | null
}

export function annotationExportCells(
  classification: ExportedClassification | null,
  comments: readonly ExportedComment[]
): AnnotationExportCells {
  const { points, overrideReason } = acmgEvidenceFields(classification?.acmg_evidence)
  const latest = comments
    .filter((c) => c.comment !== null && c.comment.trim() !== '')
    .sort((a, b) => b.updated_at - a.updated_at)[0]
  return {
    acmg_classification: classification?.acmg_classification ?? null,
    acmg_points: points,
    acmg_override_reason: overrideReason,
    annotation_comment: latest?.comment ?? null
  }
}
