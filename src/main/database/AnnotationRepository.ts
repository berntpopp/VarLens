import { BaseRepository } from './BaseRepository'
import { sql } from 'kysely'
import { InvalidParametersError } from '../ipc/errors'
import type { VariantAnnotation, CaseVariantAnnotation } from './types'
import type { BatchAnnotationKey } from '../../shared/types/api'

export class AnnotationRepository extends BaseRepository {
  /** Global annotations are keyed by genome build as well (v52, #577). */
  getGlobalAnnotation(
    chr: string,
    pos: number,
    ref: string,
    alt: string,
    genomeBuild: string
  ): VariantAnnotation | null {
    const result = this.execFirst<VariantAnnotation>(
      this.kysely
        .selectFrom('variant_annotations')
        .selectAll()
        .where('chr', '=', chr)
        .where('pos', '=', pos)
        .where('ref', '=', ref)
        .where('alt', '=', alt)
        .where('genome_build', '=', genomeBuild)
    )
    return result ?? null
  }

  /** The build of a case, or null when there is no such case. */
  caseGenomeBuild(caseId: number): string | null {
    const row = this.execFirst<{ genome_build: string }>(
      this.kysely.selectFrom('cases').select('genome_build').where('id', '=', caseId)
    )
    return row?.genome_build ?? null
  }

  upsertGlobalAnnotation(
    chr: string,
    pos: number,
    ref: string,
    alt: string,
    genomeBuild: string,
    updates: Partial<
      Pick<
        VariantAnnotation,
        'global_comment' | 'starred' | 'acmg_classification' | 'acmg_evidence'
      >
    >
  ): VariantAnnotation {
    return this.runTransaction(() => {
      const now = Date.now()
      // Use CASE WHEN to distinguish "not provided" (undefined) from "explicitly null"
      // When a key is present in updates (even if null), we write the value;
      // when a key is absent (undefined), we preserve the existing value via IFNULL.
      const acmgClassProvided = 'acmg_classification' in updates
      const acmgEvidenceProvided = 'acmg_evidence' in updates
      const commentProvided = 'global_comment' in updates

      const commentVal = updates.global_comment ?? null
      const starredVal = updates.starred !== undefined ? (updates.starred ? 1 : 0) : null
      const acmgClassVal = updates.acmg_classification ?? null
      const acmgEvidenceVal = updates.acmg_evidence ?? null

      const commentUpdate = commentProvided
        ? sql`${commentVal}`
        : sql`IFNULL(${commentVal}, global_comment)`
      const acmgClassUpdate = acmgClassProvided
        ? sql`${acmgClassVal}`
        : sql`IFNULL(${acmgClassVal}, acmg_classification)`
      const acmgEvidenceUpdate = acmgEvidenceProvided
        ? sql`${acmgEvidenceVal}`
        : sql`IFNULL(${acmgEvidenceVal}, acmg_evidence)`

      const compiled = sql<VariantAnnotation>`
          INSERT INTO variant_annotations (chr, pos, ref, alt, genome_build, global_comment, starred, acmg_classification, acmg_evidence, created_at, updated_at)
          VALUES (${chr}, ${pos}, ${ref}, ${alt}, ${genomeBuild}, ${commentVal}, IFNULL(${starredVal}, 0), ${acmgClassVal}, ${acmgEvidenceVal}, ${now}, ${now})
          ON CONFLICT(chr, pos, ref, alt, genome_build) DO UPDATE SET
            global_comment = ${commentUpdate},
            starred = IFNULL(${starredVal}, starred),
            acmg_classification = ${acmgClassUpdate},
            acmg_evidence = ${acmgEvidenceUpdate},
            updated_at = excluded.updated_at
          RETURNING *
        `.compile(this.kysely)
      const result = this.db.prepare(compiled.sql).get(...compiled.parameters) as VariantAnnotation
      return result
    })
  }

  deleteGlobalAnnotation(
    chr: string,
    pos: number,
    ref: string,
    alt: string,
    genomeBuild: string
  ): void {
    this.execRun(
      this.kysely
        .deleteFrom('variant_annotations')
        .where('chr', '=', chr)
        .where('pos', '=', pos)
        .where('ref', '=', ref)
        .where('alt', '=', alt)
        .where('genome_build', '=', genomeBuild)
    )
  }

  getPerCaseAnnotation(caseId: number, variantId: number): CaseVariantAnnotation | null {
    const result = this.execFirst<CaseVariantAnnotation>(
      this.kysely
        .selectFrom('case_variant_annotations')
        .selectAll()
        .where('case_id', '=', caseId)
        .where('variant_id', '=', variantId)
    )
    return result ?? null
  }

  upsertPerCaseAnnotation(
    caseId: number,
    variantId: number,
    updates: Partial<
      Omit<
        Pick<
          CaseVariantAnnotation,
          'per_case_comment' | 'starred' | 'acmg_classification' | 'acmg_evidence'
        >,
        'starred'
      >
    > & { starred?: number | boolean }
  ): CaseVariantAnnotation {
    return this.runTransaction(() => {
      const now = Date.now()
      // Use CASE WHEN to distinguish "not provided" (undefined) from "explicitly null"
      const acmgClassProvided = 'acmg_classification' in updates
      const acmgEvidenceProvided = 'acmg_evidence' in updates
      const commentProvided = 'per_case_comment' in updates

      const commentVal = updates.per_case_comment ?? null
      const starredVal =
        updates.starred !== undefined
          ? updates.starred === true || updates.starred === 1
            ? 1
            : 0
          : null
      const acmgClassVal = updates.acmg_classification ?? null
      const acmgEvidenceVal = updates.acmg_evidence ?? null

      const commentUpdate = commentProvided
        ? sql`${commentVal}`
        : sql`IFNULL(${commentVal}, per_case_comment)`
      const acmgClassUpdate = acmgClassProvided
        ? sql`${acmgClassVal}`
        : sql`IFNULL(${acmgClassVal}, acmg_classification)`
      const acmgEvidenceUpdate = acmgEvidenceProvided
        ? sql`${acmgEvidenceVal}`
        : sql`IFNULL(${acmgEvidenceVal}, acmg_evidence)`

      const compiled = sql<CaseVariantAnnotation>`
          INSERT INTO case_variant_annotations (case_id, variant_id, per_case_comment, starred, acmg_classification, acmg_evidence, created_at, updated_at)
          VALUES (${caseId}, ${variantId}, ${commentVal}, IFNULL(${starredVal}, 0), ${acmgClassVal}, ${acmgEvidenceVal}, ${now}, ${now})
          ON CONFLICT(case_id, variant_id) DO UPDATE SET
            per_case_comment = ${commentUpdate},
            starred = IFNULL(${starredVal}, starred),
            acmg_classification = ${acmgClassUpdate},
            acmg_evidence = ${acmgEvidenceUpdate},
            updated_at = excluded.updated_at
          RETURNING *
        `.compile(this.kysely)
      const result = this.db
        .prepare(compiled.sql)
        .get(...compiled.parameters) as CaseVariantAnnotation
      return result
    })
  }

  runInTransaction<T>(fn: () => T): T {
    return this.runTransaction(fn)
  }

  validateVariantsBelongToCase(caseId: number, variantIds: number[]): number[] {
    const uniqueIds = Array.from(new Set(variantIds))
    if (uniqueIds.length === 0) return []
    const placeholders = uniqueIds.map(() => '?').join(', ')
    const validRows = this.db
      .prepare(`SELECT id FROM variants WHERE case_id = ? AND id IN (${placeholders})`)
      .all(caseId, ...uniqueIds) as Array<{ id: number }>
    const validIds = validRows.map((r) => r.id)
    if (validIds.length !== uniqueIds.length) {
      throw new InvalidParametersError(`One or more variants do not belong to case ${caseId}`)
    }
    return validIds
  }

  batchUpsertPerCaseAnnotation(
    caseId: number,
    variantIds: number[],
    updates: Partial<
      Omit<
        CaseVariantAnnotation,
        'id' | 'case_id' | 'variant_id' | 'created_at' | 'updated_at' | 'starred'
      >
    > & { starred?: number | boolean; tag_id?: number }
  ): { updatedCount: number } {
    const uniqueIds = Array.from(new Set(variantIds))
    if (uniqueIds.length === 0) return { updatedCount: 0 }
    const validIds = this.validateVariantsBelongToCase(caseId, uniqueIds)
    return this.runTransaction(() => {
      const hasAnnotationUpdates =
        'acmg_classification' in updates ||
        'acmg_evidence' in updates ||
        'per_case_comment' in updates ||
        updates.starred !== undefined

      if (hasAnnotationUpdates) {
        for (const vId of validIds) {
          this.upsertPerCaseAnnotation(caseId, vId, updates)
        }
      }

      if (updates.tag_id !== undefined) {
        const now = Date.now()
        const tagStmt = this.db.prepare(`
          INSERT INTO variant_tags (case_id, variant_id, tag_id, created_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT DO NOTHING
        `)
        for (const vId of validIds) {
          tagStmt.run(caseId, vId, updates.tag_id, now)
        }
      }

      return { updatedCount: validIds.length }
    })
  }

  deletePerCaseAnnotation(caseId: number, variantId: number): void {
    this.execRun(
      this.kysely
        .deleteFrom('case_variant_annotations')
        .where('case_id', '=', caseId)
        .where('variant_id', '=', variantId)
    )
  }

  getAnnotationsForVariant(
    caseId: number,
    chr: string,
    pos: number,
    ref: string,
    alt: string
  ): { global: VariantAnnotation | null; perCase: CaseVariantAnnotation | null } {
    const variant = this.execFirst<{ id: number }>(
      this.kysely
        .selectFrom('variants')
        .select('id')
        .where('case_id', '=', caseId)
        .where('chr', '=', chr)
        .where('pos', '=', pos)
        .where('ref', '=', ref)
        .where('alt', '=', alt)
    )

    const variantId = variant?.id
    const build = this.caseGenomeBuild(caseId)
    const global = build === null ? null : this.getGlobalAnnotation(chr, pos, ref, alt, build)
    const perCase = variantId !== undefined ? this.getPerCaseAnnotation(caseId, variantId) : null
    return { global, perCase }
  }

  /**
   * Sprint A A1: batched annotation lookup.
   *
   * Returns a coordinate-keyed map `${chr}:${pos}:${ref}:${alt}` →
   * `{ global, perCase }` per the IPC contract (VariantAnnotationsResult).
   * The global rows are those of the case's build, or of `genomeBuild` when
   * there is no case (cohort); without either there is no global row.
   *
   * Call-count invariant (Gate 4):
   *   - caseId === null  → 1 prepared statement (global SELECT only)
   *   - caseId !== null  → 2 prepared statements (global + per-case)
   *
   * The per-case SELECT defensively joins on BOTH cva.case_id AND v.case_id
   * even when a variantId is supplied — case_variant_annotations.UNIQUE(case_id,
   * variant_id) is enforced but the FKs are independent, so a renderer-spoofed
   * variantId could otherwise read another case's annotation (Pass-8 #2).
   */
  getBatch(
    caseId: number | null,
    keys: BatchAnnotationKey[],
    genomeBuild: string | null = null
  ): Record<string, { global: VariantAnnotation | null; perCase: CaseVariantAnnotation | null }> {
    const result: Record<
      string,
      { global: VariantAnnotation | null; perCase: CaseVariantAnnotation | null }
    > = {}
    if (keys.length === 0) return result

    for (const k of keys) {
      result[`${k.chr}:${k.pos}:${k.ref}:${k.alt}`] = { global: null, perCase: null }
    }

    // Composite-tuple IN list, built textually from keys.length (SQLite only —
    // node-postgres prepared-statement caching does not apply here).
    const coordPlaceholders = keys.map(() => '(?, ?, ?, ?)').join(', ')
    const coordParams: (string | number)[] = []
    for (const k of keys) coordParams.push(k.chr, k.pos, k.ref, k.alt)

    // Global lookup — always runs (1 prepared statement). The case's build
    // wins over the caller's: a case's rows are never read in another build.
    const build = caseId !== null ? '(SELECT genome_build FROM cases WHERE id = ?)' : '?'
    const globalRows = this.db
      .prepare(
        `SELECT * FROM variant_annotations
         WHERE genome_build = ${build} AND (chr, pos, ref, alt) IN (${coordPlaceholders})`
      )
      .all(caseId ?? genomeBuild, ...coordParams) as VariantAnnotation[]
    for (const row of globalRows) {
      const key = `${row.chr}:${row.pos}:${row.ref}:${row.alt}`
      if (key in result) result[key].global = row
    }

    // Per-case lookup — only when caseId !== null (2nd prepared statement).
    if (caseId !== null) {
      const requestedVariantIdsByKey = new Map<string, Set<number>>()
      for (const k of keys) {
        if (typeof k.variantId === 'number') {
          const key = `${k.chr}:${k.pos}:${k.ref}:${k.alt}`
          let set = requestedVariantIdsByKey.get(key)
          if (!set) {
            set = new Set()
            requestedVariantIdsByKey.set(key, set)
          }
          set.add(k.variantId)
        }
      }

      const variantIds = keys
        .map((k) => k.variantId)
        .filter((v): v is number => typeof v === 'number')
      const allHaveVariantIds = variantIds.length === keys.length && variantIds.length > 0
      const idClause = allHaveVariantIds
        ? ` AND v.id IN (${variantIds.map(() => '?').join(', ')})`
        : ''
      const perCaseRows = this.db
        .prepare(
          `SELECT cva.*, v.chr AS _vchr, v.pos AS _vpos, v.ref AS _vref, v.alt AS _valt
           FROM case_variant_annotations cva
           JOIN variants v ON v.id = cva.variant_id
           WHERE cva.case_id = ?
             AND v.case_id = ?
             AND (v.chr, v.pos, v.ref, v.alt) IN (${coordPlaceholders})${idClause}
           ORDER BY cva.variant_id ASC`
        )
        .all(caseId, caseId, ...coordParams, ...(allHaveVariantIds ? variantIds : [])) as Array<
        CaseVariantAnnotation & { _vchr: string; _vpos: number; _vref: string; _valt: string }
      >
      // shortcut: getBatch returns a coordinate-keyed map per the IPC contract; prefer a matching requested variantId (#623).
      for (const row of perCaseRows) {
        const { _vchr, _vpos, _vref, _valt, ...cva } = row
        const key = `${_vchr}:${_vpos}:${_vref}:${_valt}`
        if (!(key in result)) continue
        const perCase = cva as CaseVariantAnnotation
        const requested = requestedVariantIdsByKey.get(key)
        if (result[key].perCase !== null) {
          if (requested) {
            const currentVid = result[key].perCase.variant_id
            const currentMatches = typeof currentVid === 'number' && requested.has(currentVid)
            const newMatches =
              typeof perCase.variant_id === 'number' && requested.has(perCase.variant_id)
            if (!currentMatches && newMatches) {
              result[key].perCase = perCase
            }
          }
        } else {
          result[key].perCase = perCase
        }
      }
    }

    return result
  }
}
