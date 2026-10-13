import { parseAcmgEvidence } from '../../shared/acmg/acmg-evidence'
import type { AuditAppendParams } from './audit-log-types'

/** The override reason saved with a class (#567), for its history entry. */
function overrideReasonOf(evidence: unknown): { override_reason?: string } {
  const reason =
    typeof evidence === 'string' ? (parseAcmgEvidence(evidence)?.overrideReason ?? null) : null
  return reason === null ? {} : { override_reason: reason }
}

export function globalAnnotationAuditEntries(
  coords: { chr: string; pos: number; ref: string; alt: string },
  updates: {
    user_name?: string | null
    starred?: boolean | number
    acmg_classification?: unknown
    acmg_evidence?: unknown
  },
  oldAnnotation: Record<string, unknown> | null
): AuditAppendParams[] {
  const entityKey = `${coords.chr}:${coords.pos}:${coords.ref}:${coords.alt}`
  const entries: AuditAppendParams[] = []
  if (updates.acmg_classification !== undefined) {
    entries.push({
      action_type: 'acmg_classify',
      entity_type: 'variant_annotation',
      entity_key: entityKey,
      old_value:
        oldAnnotation === null
          ? null
          : JSON.stringify({ acmg_classification: oldAnnotation.acmg_classification }),
      new_value: JSON.stringify({
        acmg_classification: updates.acmg_classification,
        ...overrideReasonOf(updates.acmg_evidence)
      }),
      user_name: updates.user_name ?? null
    })
  }
  if (updates.acmg_evidence !== undefined) {
    entries.push({
      action_type: 'acmg_evidence_update',
      entity_type: 'variant_annotation',
      entity_key: entityKey,
      old_value:
        oldAnnotation === null
          ? null
          : JSON.stringify({ acmg_evidence: oldAnnotation.acmg_evidence }),
      new_value: JSON.stringify({ acmg_evidence: updates.acmg_evidence }),
      user_name: updates.user_name ?? null
    })
  }
  if (updates.starred !== undefined) {
    const starred = updates.starred === true || updates.starred === 1
    entries.push({
      action_type: starred ? 'star' : 'unstar',
      entity_type: 'variant_annotation',
      entity_key: entityKey,
      old_value: oldAnnotation === null ? null : JSON.stringify({ starred: oldAnnotation.starred }),
      new_value: JSON.stringify({ starred: starred ? 1 : 0 }),
      user_name: updates.user_name ?? null
    })
  }
  return entries
}

export function perCaseAnnotationAuditEntries(
  caseId: number,
  variantId: number,
  updates: {
    user_name?: string | null
    starred?: boolean | number
    acmg_classification?: unknown
    acmg_evidence?: unknown
  },
  oldAnnotation: Record<string, unknown> | null
): AuditAppendParams[] {
  return globalAnnotationAuditEntries(
    { chr: 'case', pos: caseId, ref: 'variant', alt: String(variantId) },
    updates,
    oldAnnotation
  ).map((entry) => ({
    ...entry,
    entity_type: 'case_variant_annotation',
    entity_key: `case:${caseId}:variant:${variantId}`
  }))
}
