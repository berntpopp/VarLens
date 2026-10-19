/**
 * Pure business logic for annotations IPC handlers.
 *
 * All functions take explicit dependencies (db, pool) as parameters
 * and never touch IPC/Electron APIs directly. This makes them testable
 * without mocking Electron internals.
 */
import type { DatabaseService } from '../../database/DatabaseService'
import type { DbPool } from '../../database/DbPool'
import type { AcmgClassification } from '../../database/types'
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

export interface BatchPerCaseAnnotationUpdates extends PerCaseAnnotationUpdates {
  tag_id?: number
}

/**
 * Batch upsert per-case annotations via a StorageSession write executor, then
 * invoke `onChange` for each modified variant ID.
 */
export async function batchUpsertPerCaseAnnotationWithEvent(
  caseId: number,
  variantIds: number[],
  updates: BatchPerCaseAnnotationUpdates,
  getSession: () => StorageSession,
  onChange: (e: AnnotationChangeEvent) => void
): Promise<{ updatedCount: number }> {
  const result = (await getSession()
    .getWriteExecutor()
    .execute({
      type: 'annotations:batchUpsertPerCaseWithAudit',
      params: [caseId, variantIds, updates]
    })) as { updatedCount: number }
  const kind = detectAnnotationChangeKind(updates)
  if (variantIds.length > 0) {
    onChange({ caseId, variantId: variantIds[0], kind })
  }
  return result
}
