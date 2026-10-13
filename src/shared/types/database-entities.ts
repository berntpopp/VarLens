/**
 * Canonical DTOs for database entities used across process boundaries.
 *
 * These are the "shared truth" -- main process implements/extends them,
 * renderer consumes them. Never import from main/database/types in renderer.
 */

import type { AcmgClassification } from '../config/domain.config'
import type { AuditActionType, AuditEntityType } from '../audit/audit-contract'

export type { AuditActionType, AuditEntityType } from '../audit/audit-contract'

export interface Tag {
  id: number
  name: string
  color: string
  created_at: number
}

export interface VariantAnnotation {
  id: number
  chr: string
  pos: number
  ref: string
  alt: string
  /** Part of the key since v52 / PG 0035 (#577). */
  genome_build: string
  global_comment: string | null
  starred: number
  acmg_classification: AcmgClassification | null
  acmg_evidence: string | null
  created_at: number
  updated_at: number
}

export interface CaseVariantAnnotation {
  id: number
  case_id: number
  variant_id: number
  per_case_comment: string | null
  starred: number
  acmg_classification: AcmgClassification | null
  acmg_evidence: string | null
  created_at: number
  updated_at: number
}

export interface AuditLogEntry {
  id: number
  timestamp: number
  action_type: AuditActionType
  entity_type: AuditEntityType
  entity_key: string
  old_value: string | null
  new_value: string | null
  user_name: string | null
}
