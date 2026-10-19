import {
  mergedOverrideReasonMissing,
  OVERRIDE_REASON_REQUIRED,
  parseAcmgEvidence
} from '../../shared/acmg/acmg-evidence'
import { globalAnnotationEntityKey } from '../../shared/audit/annotation-entity-key'
import { InvalidParametersError } from '../ipc/errors'
import type { AuditAppendParams } from './audit-log-types'

/** The override reason saved with a class (#567), for its history entry. */
function overrideReasonOf(evidence: unknown): { override_reason?: string } {
  const reason =
    typeof evidence === 'string' ? (parseAcmgEvidence(evidence)?.overrideReason ?? null) : null
  return reason === null ? {} : { override_reason: reason }
}

/**
 * #567 on the row as it will be stored (update over `stored`); refuses the
 * write before anything changes. Both backends' audited writes call it.
 */
export function assertOverrideReason(
  updates: object,
  stored: Record<string, unknown> | null
): void {
  if (mergedOverrideReasonMissing(updates as Record<string, unknown>, stored)) {
    throw new InvalidParametersError(OVERRIDE_REASON_REQUIRED, OVERRIDE_REASON_REQUIRED)
  }
}

export function globalAnnotationAuditEntries(
  coords: { chr: string; pos: number; ref: string; alt: string; genome_build?: string },
  updates: {
    user_name?: string | null
    starred?: boolean | number
    acmg_classification?: unknown
    acmg_evidence?: unknown
  },
  oldAnnotation: Record<string, unknown> | null
): AuditAppendParams[] {
  const entityKey = globalAnnotationEntityKey(coords, coords.genome_build)
  const entries: AuditAppendParams[] = []
  if ('acmg_classification' in updates) {
    entries.push({
      action_type: 'acmg_classify',
      entity_type: 'variant_annotation',
      entity_key: entityKey,
      old_value:
        oldAnnotation === null
          ? null
          : JSON.stringify({ acmg_classification: oldAnnotation.acmg_classification }),
      new_value: JSON.stringify({
        acmg_classification: updates.acmg_classification ?? null,
        ...overrideReasonOf(updates.acmg_evidence)
      }),
      user_name: updates.user_name ?? null
    })
  }
  if ('acmg_evidence' in updates) {
    entries.push({
      action_type: 'acmg_evidence_update',
      entity_type: 'variant_annotation',
      entity_key: entityKey,
      old_value:
        oldAnnotation === null
          ? null
          : JSON.stringify({ acmg_evidence: oldAnnotation.acmg_evidence }),
      new_value: JSON.stringify({ acmg_evidence: updates.acmg_evidence ?? null }),
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
    tag_id?: number
  },
  oldAnnotation: Record<string, unknown> | null
): AuditAppendParams[] {
  const entries: AuditAppendParams[] = globalAnnotationAuditEntries(
    { chr: 'case', pos: caseId, ref: 'variant', alt: String(variantId) },
    updates,
    oldAnnotation
  ).map((entry) => ({
    ...entry,
    entity_type: 'case_variant_annotation' as const,
    entity_key: `case:${caseId}:variant:${variantId}`
  }))

  if (updates.tag_id !== undefined) {
    entries.push({
      action_type: 'tag_assign',
      entity_type: 'case_variant_annotation',
      entity_key: `case:${caseId}:variant:${variantId}`,
      old_value: null,
      new_value: JSON.stringify({ tag_id: updates.tag_id }),
      user_name: updates.user_name ?? null
    })
  }

  return entries
}
