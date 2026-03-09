import { BaseRepository } from './BaseRepository'
import type { VariantAnnotation, CaseVariantAnnotation } from './types'

export class AnnotationRepository extends BaseRepository {
  getGlobalAnnotation(
    chr: string,
    pos: number,
    ref: string,
    alt: string
  ): VariantAnnotation | null {
    const result = this.execFirst<VariantAnnotation>(
      this.kysely
        .selectFrom('variant_annotations')
        .selectAll()
        .where('chr', '=', chr)
        .where('pos', '=', pos)
        .where('ref', '=', ref)
        .where('alt', '=', alt)
    )
    return result ?? null
  }

  upsertGlobalAnnotation(
    chr: string,
    pos: number,
    ref: string,
    alt: string,
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

      const result = this.stmt(
        `
        INSERT INTO variant_annotations (chr, pos, ref, alt, global_comment, starred, acmg_classification, acmg_evidence, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, IFNULL(?, 0), ?, ?, ?, ?)
        ON CONFLICT(chr, pos, ref, alt) DO UPDATE SET
          global_comment = ${commentProvided ? '?' : 'IFNULL(?, global_comment)'},
          starred = IFNULL(?, starred),
          acmg_classification = ${acmgClassProvided ? '?' : 'IFNULL(?, acmg_classification)'},
          acmg_evidence = ${acmgEvidenceProvided ? '?' : 'IFNULL(?, acmg_evidence)'},
          updated_at = excluded.updated_at
        RETURNING *
      `
      ).get(
        chr,
        pos,
        ref,
        alt,
        updates.global_comment ?? null,
        updates.starred !== undefined ? (updates.starred ? 1 : 0) : null,
        updates.acmg_classification ?? null,
        updates.acmg_evidence ?? null,
        now,
        now,
        updates.global_comment ?? null,
        updates.starred !== undefined ? (updates.starred ? 1 : 0) : null,
        updates.acmg_classification ?? null,
        updates.acmg_evidence ?? null
      ) as VariantAnnotation
      return result
    })
  }

  deleteGlobalAnnotation(chr: string, pos: number, ref: string, alt: string): void {
    this.execRun(
      this.kysely
        .deleteFrom('variant_annotations')
        .where('chr', '=', chr)
        .where('pos', '=', pos)
        .where('ref', '=', ref)
        .where('alt', '=', alt)
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
      Pick<
        CaseVariantAnnotation,
        'per_case_comment' | 'starred' | 'acmg_classification' | 'acmg_evidence'
      >
    >
  ): CaseVariantAnnotation {
    return this.runTransaction(() => {
      const now = Date.now()
      // Use CASE WHEN to distinguish "not provided" (undefined) from "explicitly null"
      const acmgClassProvided = 'acmg_classification' in updates
      const acmgEvidenceProvided = 'acmg_evidence' in updates
      const commentProvided = 'per_case_comment' in updates

      const result = this.stmt(
        `
        INSERT INTO case_variant_annotations (case_id, variant_id, per_case_comment, starred, acmg_classification, acmg_evidence, created_at, updated_at)
        VALUES (?, ?, ?, IFNULL(?, 0), ?, ?, ?, ?)
        ON CONFLICT(case_id, variant_id) DO UPDATE SET
          per_case_comment = ${commentProvided ? '?' : 'IFNULL(?, per_case_comment)'},
          starred = IFNULL(?, starred),
          acmg_classification = ${acmgClassProvided ? '?' : 'IFNULL(?, acmg_classification)'},
          acmg_evidence = ${acmgEvidenceProvided ? '?' : 'IFNULL(?, acmg_evidence)'},
          updated_at = excluded.updated_at
        RETURNING *
      `
      ).get(
        caseId,
        variantId,
        updates.per_case_comment ?? null,
        updates.starred !== undefined ? (updates.starred ? 1 : 0) : null,
        updates.acmg_classification ?? null,
        updates.acmg_evidence ?? null,
        now,
        now,
        updates.per_case_comment ?? null,
        updates.starred !== undefined ? (updates.starred ? 1 : 0) : null,
        updates.acmg_classification ?? null,
        updates.acmg_evidence ?? null
      ) as CaseVariantAnnotation
      return result
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
    const global = this.getGlobalAnnotation(chr, pos, ref, alt)
    const perCase = variantId !== undefined ? this.getPerCaseAnnotation(caseId, variantId) : null
    return { global, perCase }
  }
}
