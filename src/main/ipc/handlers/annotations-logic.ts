/**
 * Pure business logic for annotations IPC handlers.
 *
 * All functions take explicit dependencies (db, pool) as parameters
 * and never touch IPC/Electron APIs directly. This makes them testable
 * without mocking Electron internals.
 */
import type { DatabaseService } from '../../database/DatabaseService'
import type { DbPool } from '../../database/DbPool'
import type {
  VariantAnnotation,
  CaseVariantAnnotation,
  AcmgClassification
} from '../../database/types'
import type { AnnotationChangeEvent } from '../../../shared/types/api'
import type { StorageSession } from '../../storage/session'

/** Validated variant coordinates. */
export interface VariantCoords {
  chr: string
  pos: number
  ref: string
  alt: string
}

/** Coordinates of a global annotation: keyed by genome build too (#577). */
export interface GlobalVariantCoords extends VariantCoords {
  genome_build: string
}

/** Validated global annotation updates (after Zod parsing). */
export interface GlobalAnnotationUpdates {
  user_name?: string | null
  global_comment?: string | null
  starred?: boolean
  acmg_classification?: AcmgClassification | null
  acmg_evidence?: string | null
}

/** Validated per-case annotation updates (after Zod parsing). */
export interface PerCaseAnnotationUpdates {
  user_name?: string | null
  per_case_comment?: string | null
  starred?: boolean
  acmg_classification?: AcmgClassification | null
  acmg_evidence?: string | null
}

/** Variant key for batch operations. */
export interface VariantKey {
  chr: string
  pos: number
  ref: string
  alt: string
}

/**
 * Get global annotation for a variant.
 */
export async function getGlobalAnnotation(
  coords: GlobalVariantCoords,
  getDb: () => DatabaseService,
  getDbPool?: () => DbPool | null
): Promise<unknown> {
  const pool = getDbPool?.()
  if (pool) {
    return await pool.run({
      type: 'annotations:getGlobal',
      params: [coords.chr, coords.pos, coords.ref, coords.alt, coords.genome_build]
    })
  }

  const db = getDb()
  return db.annotations.getGlobalAnnotation(
    coords.chr,
    coords.pos,
    coords.ref,
    coords.alt,
    coords.genome_build
  )
}

/**
 * Upsert global annotation for a variant.
 * Handles state comparison and audit trail creation.
 */
export function upsertGlobalAnnotation(
  coords: GlobalVariantCoords,
  updates: GlobalAnnotationUpdates,
  getDb: () => DatabaseService
): unknown {
  const db = getDb()
  const { chr: vChr, pos: vPos, ref: vRef, alt: vAlt, genome_build: build } = coords

  // Extract user_name before building db updates
  const { user_name, ...annotationUpdates } = updates

  // Read current state before upsert for audit trail
  const oldAnnotation = db.annotations.getGlobalAnnotation(vChr, vPos, vRef, vAlt, build)

  // Build dbUpdates only with keys actually provided
  const dbUpdates: Partial<
    Pick<VariantAnnotation, 'global_comment' | 'starred' | 'acmg_classification' | 'acmg_evidence'>
  > = {}

  if ('global_comment' in annotationUpdates) {
    dbUpdates.global_comment = annotationUpdates.global_comment
  }
  if ('acmg_classification' in annotationUpdates) {
    dbUpdates.acmg_classification = annotationUpdates.acmg_classification
  }
  if ('acmg_evidence' in annotationUpdates) {
    dbUpdates.acmg_evidence = annotationUpdates.acmg_evidence
  }
  if (annotationUpdates.starred !== undefined) {
    dbUpdates.starred = annotationUpdates.starred ? 1 : 0
  }

  const result = db.annotations.upsertGlobalAnnotation(vChr, vPos, vRef, vAlt, build, dbUpdates)

  // Audit logging
  const entityKey = `${vChr}:${vPos}:${vRef}:${vAlt}`
  if (annotationUpdates.acmg_classification !== undefined) {
    db.auditLog.appendEntry({
      action_type: 'acmg_classify',
      entity_type: 'variant_annotation',
      entity_key: entityKey,
      old_value: oldAnnotation
        ? JSON.stringify({ acmg_classification: oldAnnotation.acmg_classification })
        : null,
      new_value: JSON.stringify({
        acmg_classification: annotationUpdates.acmg_classification
      }),
      user_name: user_name ?? null
    })
  }
  if (annotationUpdates.acmg_evidence !== undefined) {
    db.auditLog.appendEntry({
      action_type: 'acmg_evidence_update',
      entity_type: 'variant_annotation',
      entity_key: entityKey,
      old_value: oldAnnotation
        ? JSON.stringify({ acmg_evidence: oldAnnotation.acmg_evidence })
        : null,
      new_value: JSON.stringify({ acmg_evidence: annotationUpdates.acmg_evidence }),
      user_name: user_name ?? null
    })
  }
  if (annotationUpdates.starred !== undefined) {
    db.auditLog.appendEntry({
      action_type: annotationUpdates.starred ? 'star' : 'unstar',
      entity_type: 'variant_annotation',
      entity_key: entityKey,
      old_value: oldAnnotation ? JSON.stringify({ starred: oldAnnotation.starred }) : null,
      new_value: JSON.stringify({ starred: annotationUpdates.starred ? 1 : 0 }),
      user_name: user_name ?? null
    })
  }

  return result
}

/**
 * Delete global annotation for a variant.
 */
export function deleteGlobalAnnotation(
  coords: GlobalVariantCoords,
  getDb: () => DatabaseService
): void {
  const db = getDb()
  db.annotations.deleteGlobalAnnotation(
    coords.chr,
    coords.pos,
    coords.ref,
    coords.alt,
    coords.genome_build
  )
}

/**
 * Get per-case annotation for a variant.
 */
export async function getPerCaseAnnotation(
  caseId: number,
  variantId: number,
  getDb: () => DatabaseService,
  getDbPool?: () => DbPool | null
): Promise<unknown> {
  const pool = getDbPool?.()
  if (pool) {
    return await pool.run({
      type: 'annotations:getPerCase',
      params: [caseId, variantId]
    })
  }

  const db = getDb()
  return db.annotations.getPerCaseAnnotation(caseId, variantId)
}

/**
 * Upsert per-case annotation for a variant.
 * Handles state comparison and audit trail creation.
 */
export function upsertPerCaseAnnotation(
  caseId: number,
  variantId: number,
  updates: PerCaseAnnotationUpdates,
  getDb: () => DatabaseService
): unknown {
  const db = getDb()

  // Extract user_name before building db updates
  const { user_name, ...annotationUpdates } = updates

  // Read current state before upsert for audit trail
  const oldAnnotation = db.annotations.getPerCaseAnnotation(caseId, variantId)

  // Build dbUpdates only with keys actually provided
  const dbUpdates: Partial<
    Pick<
      CaseVariantAnnotation,
      'per_case_comment' | 'starred' | 'acmg_classification' | 'acmg_evidence'
    >
  > = {}

  if ('per_case_comment' in annotationUpdates) {
    dbUpdates.per_case_comment = annotationUpdates.per_case_comment
  }
  if ('acmg_classification' in annotationUpdates) {
    dbUpdates.acmg_classification = annotationUpdates.acmg_classification
  }
  if ('acmg_evidence' in annotationUpdates) {
    dbUpdates.acmg_evidence = annotationUpdates.acmg_evidence
  }
  if (annotationUpdates.starred !== undefined) {
    dbUpdates.starred = annotationUpdates.starred ? 1 : 0
  }

  const result = db.annotations.upsertPerCaseAnnotation(caseId, variantId, dbUpdates)

  // Audit logging
  const entityKey = `case:${caseId}:variant:${variantId}`
  if (annotationUpdates.acmg_classification !== undefined) {
    db.auditLog.appendEntry({
      action_type: 'acmg_classify',
      entity_type: 'case_variant_annotation',
      entity_key: entityKey,
      old_value: oldAnnotation
        ? JSON.stringify({ acmg_classification: oldAnnotation.acmg_classification })
        : null,
      new_value: JSON.stringify({
        acmg_classification: annotationUpdates.acmg_classification
      }),
      user_name: user_name ?? null
    })
  }
  if (annotationUpdates.acmg_evidence !== undefined) {
    db.auditLog.appendEntry({
      action_type: 'acmg_evidence_update',
      entity_type: 'case_variant_annotation',
      entity_key: entityKey,
      old_value: oldAnnotation
        ? JSON.stringify({ acmg_evidence: oldAnnotation.acmg_evidence })
        : null,
      new_value: JSON.stringify({ acmg_evidence: annotationUpdates.acmg_evidence }),
      user_name: user_name ?? null
    })
  }
  if (annotationUpdates.starred !== undefined) {
    db.auditLog.appendEntry({
      action_type: annotationUpdates.starred ? 'star' : 'unstar',
      entity_type: 'case_variant_annotation',
      entity_key: entityKey,
      old_value: oldAnnotation ? JSON.stringify({ starred: oldAnnotation.starred }) : null,
      new_value: JSON.stringify({ starred: annotationUpdates.starred ? 1 : 0 }),
      user_name: user_name ?? null
    })
  }

  return result
}

/**
 * Delete per-case annotation for a variant.
 */
export function deletePerCaseAnnotation(
  caseId: number,
  variantId: number,
  getDb: () => DatabaseService
): void {
  const db = getDb()
  db.annotations.deletePerCaseAnnotation(caseId, variantId)
}

/**
 * Get all annotations for a variant (global + per-case).
 */
export async function getAnnotationsForVariant(
  caseId: number,
  coords: VariantCoords,
  getDb: () => DatabaseService,
  getDbPool?: () => DbPool | null
): Promise<unknown> {
  const pool = getDbPool?.()
  if (pool) {
    return await pool.run({
      type: 'annotations:getForVariant',
      params: [caseId, coords.chr, coords.pos, coords.ref, coords.alt]
    })
  }

  const db = getDb()
  return db.annotations.getAnnotationsForVariant(
    caseId,
    coords.chr,
    coords.pos,
    coords.ref,
    coords.alt
  )
}

/**
 * Batch read annotations -- single round-trip for N variants (pool-dispatched).
 * Global rows are those of the case's build, or of `genomeBuild` without a case.
 */
export async function batchGetAnnotations(
  caseId: number | null,
  variantKeys: VariantKey[],
  getDb: () => DatabaseService,
  getDbPool?: () => DbPool | null,
  genomeBuild: string | null = null
): Promise<unknown> {
  const pool = getDbPool?.()
  if (pool) {
    return await pool.run({
      type: 'annotations:batchGet' as const,
      params: [caseId, variantKeys, genomeBuild]
    })
  }
  const db = getDb()
  return db.annotations.getBatch(caseId, variantKeys, genomeBuild)
}

// ---------------------------------------------------------------------------
// Session-based helpers (transport-agnostic, shared by web and desktop)
// ---------------------------------------------------------------------------

/**
 * Map per-case annotation update fields to the broadcast/SSE event `kind`.
 * Priority order: star → acmg → evidence → comment.
 * Exported so it is the single source of truth — web route and desktop
 * handler both import from here rather than duplicating the logic.
 */
export function detectAnnotationChangeKind(updates: {
  starred?: unknown
  acmg_classification?: unknown
  acmg_evidence?: unknown
}): AnnotationChangeEvent['kind'] {
  if (updates.starred !== undefined) return 'star'
  if (updates.acmg_classification !== undefined) return 'acmg'
  if (updates.acmg_evidence !== undefined) return 'evidence'
  return 'comment'
}

/**
 * Upsert a global annotation via a StorageSession write executor.
 * Delegates to the composite `annotations:upsertGlobalWithAudit` task so that
 * audit-trail creation is handled by the backend (Postgres) or executor.
 */
export async function upsertGlobalAnnotationViaSession(
  coords: GlobalVariantCoords,
  updates: GlobalAnnotationUpdates,
  getSession: () => StorageSession
): Promise<unknown> {
  return getSession()
    .getWriteExecutor()
    .execute({ type: 'annotations:upsertGlobalWithAudit', params: [coords, updates] })
}

/**
 * Upsert a per-case annotation via a StorageSession write executor, then
 * invoke the caller-supplied `onChange` callback with the change event.
 * The callback is called only after a successful write; a thrown error
 * propagates before `onChange` is reached.
 */
export async function upsertPerCaseAnnotationWithEvent(
  caseId: number,
  variantId: number,
  updates: PerCaseAnnotationUpdates,
  getSession: () => StorageSession,
  onChange: (e: AnnotationChangeEvent) => void
): Promise<unknown> {
  const result = await getSession()
    .getWriteExecutor()
    .execute({ type: 'annotations:upsertPerCaseWithAudit', params: [caseId, variantId, updates] })
  onChange({ caseId, variantId, kind: detectAnnotationChangeKind(updates) })
  return result
}
