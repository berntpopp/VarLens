import type { Pool, PoolClient } from 'pg'

import type { BatchAnnotationKey } from '../../../shared/types/api'
import type {
  AcmgClassification,
  CaseVariantAnnotation,
  VariantAnnotation
} from '../../../shared/types/database'
import { globalAnnotationAuditEntries, perCaseAnnotationAuditEntries } from '../annotation-audit'
import {
  applyAnnotationFlagsGlobal,
  applyAnnotationFlagsOnCaseDelete,
  applyAnnotationFlagsPerCase,
  beginAnnotationWrite
} from './cohort-annotation-flags-sql'
import { quoteIdentifier } from './identifiers'
import { runNamed } from './named-query'
import { PostgresAuditLogRepository } from './PostgresAuditLogRepository'

type QueryablePool = Pick<Pool, 'query'>
type TransactionCapablePool = QueryablePool & { connect: () => Promise<PoolClient> }

// prettier-ignore
type GlobalAnnotationUpdates = Partial<
  Omit<Pick<VariantAnnotation, 'global_comment' | 'starred' | 'acmg_classification' | 'acmg_evidence'>, 'starred'> & {
    starred: number | boolean
  }
>

// prettier-ignore
type PerCaseAnnotationUpdates = Partial<
  Omit<Pick<CaseVariantAnnotation, 'per_case_comment' | 'starred' | 'acmg_classification' | 'acmg_evidence'>, 'starred'> & {
    starred: number | boolean
  }
>

type VariantKey = { chr: string; pos: number; ref: string; alt: string }

const nowExpression = '(EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::bigint'

function toNumber(value: unknown): number {
  if (typeof value === 'number') return value
  if (typeof value === 'bigint' || typeof value === 'string') return Number(value)
  if (typeof value === 'boolean') return value ? 1 : 0
  return 0
}

function toStarredNumber(value: unknown): number {
  return toNumber(value) === 0 ? 0 : 1
}

function toGlobalAnnotation(row: Record<string, unknown>): VariantAnnotation {
  return {
    id: toNumber(row.id),
    chr: String(row.chr),
    pos: toNumber(row.pos),
    ref: String(row.ref),
    alt: String(row.alt),
    global_comment: row.global_comment === null ? null : String(row.global_comment),
    starred: toStarredNumber(row.starred),
    acmg_classification: (row.acmg_classification ?? null) as AcmgClassification | null,
    acmg_evidence: row.acmg_evidence === null ? null : String(row.acmg_evidence),
    created_at: toNumber(row.created_at),
    updated_at: toNumber(row.updated_at)
  }
}

function toPerCaseAnnotation(row: Record<string, unknown>): CaseVariantAnnotation {
  return {
    id: toNumber(row.id),
    case_id: toNumber(row.case_id),
    variant_id: toNumber(row.variant_id),
    per_case_comment: row.per_case_comment === null ? null : String(row.per_case_comment),
    starred: toStarredNumber(row.starred),
    acmg_classification: (row.acmg_classification ?? null) as AcmgClassification | null,
    acmg_evidence: row.acmg_evidence === null ? null : String(row.acmg_evidence),
    created_at: toNumber(row.created_at),
    updated_at: toNumber(row.updated_at)
  }
}

function variantKey(key: VariantKey): string {
  return `${key.chr}:${key.pos}:${key.ref}:${key.alt}`
}

async function rollbackTransaction(client: Pick<PoolClient, 'query'>): Promise<void> {
  try {
    await client.query('ROLLBACK')
  } catch {
    // Preserve the original transaction failure; rollback errors add noise here.
  }
}

export class PostgresAnnotationsRepository {
  constructor(
    private readonly pool: QueryablePool,
    private readonly schema: string,
    private readonly summaryLockWaitMs?: number
  ) {}

  async getGlobalAnnotation(
    chr: string,
    pos: number,
    ref: string,
    alt: string
  ): Promise<VariantAnnotation | null> {
    const schemaName = quoteIdentifier(this.schema)
    const result = await this.pool.query(
      `
        SELECT *
        FROM ${schemaName}."variant_annotations"
        WHERE chr = $1 AND pos = $2 AND ref = $3 AND alt = $4
        LIMIT 1
      `,
      [chr, pos, ref, alt]
    )

    const row = result.rows[0]
    return row === undefined ? null : toGlobalAnnotation(row)
  }

  async upsertGlobalAnnotation(
    chr: string,
    pos: number,
    ref: string,
    alt: string,
    updates: GlobalAnnotationUpdates
  ): Promise<VariantAnnotation> {
    const client = await this.connect()
    try {
      const flags = await beginAnnotationWrite(client, this.schema, this.summaryLockWaitMs)
      const result = await this._upsertGlobalAnnotationOn(client, chr, pos, ref, alt, updates)
      await applyAnnotationFlagsGlobal(client, { ...flags, chr, pos, ref, alt })
      await client.query('COMMIT')
      return result
    } catch (error) {
      await rollbackTransaction(client)
      throw error
    } finally {
      client.release()
    }
  }

  // Raw-SQL helper — operates on the passed client/pool, no BEGIN/COMMIT.
  // Public wrapper and *WithAudit transactions both route through here so the
  // upsert never opens its own transaction (would nest under audit's BEGIN).
  private async _upsertGlobalAnnotationOn(
    client: QueryablePool,
    chr: string,
    pos: number,
    ref: string,
    alt: string,
    updates: GlobalAnnotationUpdates
  ): Promise<VariantAnnotation> {
    const schemaName = quoteIdentifier(this.schema)
    const commentProvided = 'global_comment' in updates
    const starredProvided = updates.starred !== undefined
    const acmgClassProvided = 'acmg_classification' in updates
    const acmgEvidenceProvided = 'acmg_evidence' in updates
    const params = [
      chr,
      pos,
      ref,
      alt,
      updates.global_comment ?? null,
      starredProvided ? toStarredNumber(updates.starred) : 0,
      updates.acmg_classification ?? null,
      updates.acmg_evidence ?? null,
      commentProvided,
      starredProvided,
      acmgClassProvided,
      acmgEvidenceProvided
    ]

    const result = await runNamed(client as Pool, {
      name: 'annotations:upsert_global:v1',
      text: `
        INSERT INTO ${schemaName}."variant_annotations" (
          chr,
          pos,
          ref,
          alt,
          global_comment,
          starred,
          acmg_classification,
          acmg_evidence,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, ${nowExpression}, ${nowExpression})
        ON CONFLICT (chr, pos, ref, alt) DO UPDATE SET
          global_comment = CASE
            WHEN $9 THEN EXCLUDED.global_comment
            ELSE variant_annotations.global_comment
          END,
          starred = CASE
            WHEN $10 THEN EXCLUDED.starred
            ELSE variant_annotations.starred
          END,
          acmg_classification = CASE
            WHEN $11 THEN EXCLUDED.acmg_classification
            ELSE variant_annotations.acmg_classification
          END,
          acmg_evidence = CASE
            WHEN $12 THEN EXCLUDED.acmg_evidence
            ELSE variant_annotations.acmg_evidence
          END,
          updated_at = EXCLUDED.updated_at
        RETURNING *
      `,
      values: params,
      schema: this.schema
    })

    return toGlobalAnnotation(result.rows[0])
  }

  async upsertGlobalAnnotationWithAudit(
    chr: string,
    pos: number,
    ref: string,
    alt: string,
    updates: GlobalAnnotationUpdates & { user_name?: string | null }
  ): Promise<VariantAnnotation> {
    const client = await this.connect()
    try {
      const flags = await beginAnnotationWrite(client, this.schema, this.summaryLockWaitMs)
      const annotations = new PostgresAnnotationsRepository(client, this.schema)
      const audit = new PostgresAuditLogRepository(client, this.schema)
      const oldAnnotation = await annotations.getGlobalAnnotation(chr, pos, ref, alt)
      const result = await this._upsertGlobalAnnotationOn(client, chr, pos, ref, alt, updates)
      for (const entry of globalAnnotationAuditEntries(
        { chr, pos, ref, alt },
        updates,
        oldAnnotation as Record<string, unknown> | null
      )) {
        await audit.append(entry)
      }
      await applyAnnotationFlagsGlobal(client, { ...flags, chr, pos, ref, alt })
      await client.query('COMMIT')
      return result
    } catch (error) {
      await rollbackTransaction(client)
      throw error
    } finally {
      client.release()
    }
  }

  async deleteGlobalAnnotation(chr: string, pos: number, ref: string, alt: string): Promise<void> {
    const client = await this.connect()
    try {
      const flags = await beginAnnotationWrite(client, this.schema, this.summaryLockWaitMs)
      await this._deleteGlobalAnnotationOn(client, chr, pos, ref, alt)
      await applyAnnotationFlagsGlobal(client, { ...flags, chr, pos, ref, alt })
      await client.query('COMMIT')
    } catch (error) {
      await rollbackTransaction(client)
      throw error
    } finally {
      client.release()
    }
  }

  // Raw-SQL helper — operates on the passed client/pool, no BEGIN/COMMIT.
  private async _deleteGlobalAnnotationOn(
    client: QueryablePool,
    chr: string,
    pos: number,
    ref: string,
    alt: string
  ): Promise<void> {
    const schemaName = quoteIdentifier(this.schema)
    await runNamed(client as Pool, {
      name: 'annotations:delete_global:v1',
      text: `
        DELETE FROM ${schemaName}."variant_annotations"
        WHERE chr = $1 AND pos = $2 AND ref = $3 AND alt = $4
      `,
      values: [chr, pos, ref, alt],
      schema: this.schema
    })
  }

  async getPerCaseAnnotation(
    caseId: number,
    variantId: number
  ): Promise<CaseVariantAnnotation | null> {
    const schemaName = quoteIdentifier(this.schema)
    const result = await this.pool.query(
      `
        SELECT *
        FROM ${schemaName}."case_variant_annotations"
        WHERE case_id = $1 AND variant_id = $2
        LIMIT 1
      `,
      [caseId, variantId]
    )

    const row = result.rows[0]
    return row === undefined ? null : toPerCaseAnnotation(row)
  }

  async upsertPerCaseAnnotation(
    caseId: number,
    variantId: number,
    updates: PerCaseAnnotationUpdates
  ): Promise<CaseVariantAnnotation> {
    const client = await this.connect()
    try {
      const flags = await beginAnnotationWrite(client, this.schema, this.summaryLockWaitMs)
      const result = await this._upsertPerCaseAnnotationOn(client, caseId, variantId, updates)
      await applyAnnotationFlagsPerCase(client, { ...flags, caseId, variantId })
      await client.query('COMMIT')
      return result
    } catch (error) {
      await rollbackTransaction(client)
      throw error
    } finally {
      client.release()
    }
  }

  // Raw-SQL helper — operates on the passed client/pool, no BEGIN/COMMIT.
  private async _upsertPerCaseAnnotationOn(
    client: QueryablePool,
    caseId: number,
    variantId: number,
    updates: PerCaseAnnotationUpdates
  ): Promise<CaseVariantAnnotation> {
    const schemaName = quoteIdentifier(this.schema)
    const commentProvided = 'per_case_comment' in updates
    const starredProvided = updates.starred !== undefined
    const acmgClassProvided = 'acmg_classification' in updates
    const acmgEvidenceProvided = 'acmg_evidence' in updates
    const params = [
      caseId,
      variantId,
      updates.per_case_comment ?? null,
      starredProvided ? toStarredNumber(updates.starred) : 0,
      updates.acmg_classification ?? null,
      updates.acmg_evidence ?? null,
      commentProvided,
      starredProvided,
      acmgClassProvided,
      acmgEvidenceProvided
    ]

    const result = await runNamed(client as Pool, {
      name: 'annotations:upsert_per_case:v1',
      text: `
        INSERT INTO ${schemaName}."case_variant_annotations" (
          case_id,
          variant_id,
          per_case_comment,
          starred,
          acmg_classification,
          acmg_evidence,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, ${nowExpression}, ${nowExpression})
        ON CONFLICT (case_id, variant_id) DO UPDATE SET
          per_case_comment = CASE
            WHEN $7 THEN EXCLUDED.per_case_comment
            ELSE case_variant_annotations.per_case_comment
          END,
          starred = CASE
            WHEN $8 THEN EXCLUDED.starred
            ELSE case_variant_annotations.starred
          END,
          acmg_classification = CASE
            WHEN $9 THEN EXCLUDED.acmg_classification
            ELSE case_variant_annotations.acmg_classification
          END,
          acmg_evidence = CASE
            WHEN $10 THEN EXCLUDED.acmg_evidence
            ELSE case_variant_annotations.acmg_evidence
          END,
          updated_at = EXCLUDED.updated_at
        RETURNING *
      `,
      values: params,
      schema: this.schema
    })

    return toPerCaseAnnotation(result.rows[0])
  }

  async upsertPerCaseAnnotationWithAudit(
    caseId: number,
    variantId: number,
    updates: PerCaseAnnotationUpdates & { user_name?: string | null }
  ): Promise<CaseVariantAnnotation> {
    const client = await this.connect()
    try {
      const flags = await beginAnnotationWrite(client, this.schema, this.summaryLockWaitMs)
      const annotations = new PostgresAnnotationsRepository(client, this.schema)
      const audit = new PostgresAuditLogRepository(client, this.schema)
      const oldAnnotation = await annotations.getPerCaseAnnotation(caseId, variantId)
      const result = await this._upsertPerCaseAnnotationOn(client, caseId, variantId, updates)
      for (const entry of perCaseAnnotationAuditEntries(
        caseId,
        variantId,
        updates,
        oldAnnotation as Record<string, unknown> | null
      )) {
        await audit.append(entry)
      }
      await applyAnnotationFlagsPerCase(client, { ...flags, caseId, variantId })
      await client.query('COMMIT')
      return result
    } catch (error) {
      await rollbackTransaction(client)
      throw error
    } finally {
      client.release()
    }
  }

  async deletePerCaseAnnotation(caseId: number, variantId: number): Promise<void> {
    const client = await this.connect()
    try {
      const flags = await beginAnnotationWrite(client, this.schema, this.summaryLockWaitMs)
      await this._deletePerCaseAnnotationOn(client, caseId, variantId)
      await applyAnnotationFlagsPerCase(client, { ...flags, caseId, variantId })
      await client.query('COMMIT')
    } catch (error) {
      await rollbackTransaction(client)
      throw error
    } finally {
      client.release()
    }
  }

  // Raw-SQL helper — operates on the passed client/pool, no BEGIN/COMMIT.
  private async _deletePerCaseAnnotationOn(
    client: QueryablePool,
    caseId: number,
    variantId: number
  ): Promise<void> {
    const schemaName = quoteIdentifier(this.schema)
    await runNamed(client as Pool, {
      name: 'annotations:delete_per_case:v1',
      text: `
        DELETE FROM ${schemaName}."case_variant_annotations"
        WHERE case_id = $1 AND variant_id = $2
      `,
      values: [caseId, variantId],
      schema: this.schema
    })
  }

  async getAnnotationsForVariant(
    caseId: number,
    chr: string,
    pos: number,
    ref: string,
    alt: string
  ): Promise<{ global: VariantAnnotation | null; perCase: CaseVariantAnnotation | null }> {
    const schemaName = quoteIdentifier(this.schema)
    const variantResult = await this.pool.query(
      `
        SELECT id
        FROM ${schemaName}."variants"
        WHERE case_id = $1 AND chr = $2 AND pos = $3 AND ref = $4 AND alt = $5
        LIMIT 1
      `,
      [caseId, chr, pos, ref, alt]
    )

    const global = await this.getGlobalAnnotation(chr, pos, ref, alt)
    const variantId = variantResult.rows[0]?.id
    const perCase =
      variantId === undefined || variantId === null
        ? null
        : await this.getPerCaseAnnotation(caseId, toNumber(variantId))

    return { global, perCase }
  }

  /**
   * On-case-delete annotation write-hook (C5a / Pass-5 HIGH #1). Public (unlike
   * the global/per-case hooks, which only fire from this class's own methods)
   * because C3's PostgresCaseLifecycleRepository invokes it across the class
   * boundary BEFORE deleting the case. Thin delegate to the shared executor in
   * cohort-annotation-flags-sql.ts; see that module for the exclusion semantics.
   */
  async _applyAnnotationFlagsOnCaseDelete(
    client: QueryablePool,
    args: { schema: string; deletedCaseId: number }
  ): Promise<void> {
    await applyAnnotationFlagsOnCaseDelete(client, args)
  }

  private async connect(): Promise<PoolClient> {
    const pool = this.pool as Partial<TransactionCapablePool>
    if (pool.connect === undefined) {
      throw new Error('Postgres annotation audit writes require a transaction-capable pool')
    }
    return await pool.connect()
  }

  async getBatch(
    caseId: number | null,
    variantKeys: BatchAnnotationKey[]
  ): Promise<
    Record<string, { global: VariantAnnotation | null; perCase: CaseVariantAnnotation | null }>
  > {
    const annotations: Record<
      string,
      { global: VariantAnnotation | null; perCase: CaseVariantAnnotation | null }
    > = {}
    for (const key of variantKeys) {
      annotations[variantKey(key)] = { global: null, perCase: null }
    }
    if (variantKeys.length === 0) return annotations

    const schemaName = quoteIdentifier(this.schema)

    // Four parallel arrays — one element per key. Binding the coordinate tuples
    // as UNNEST(text[], bigint[], text[], text[]) keeps the SQL text invariant
    // regardless of batch size (Pass-9 #1), and both SELECTs are issued via
    // runNamed (PR-2 B2) for prepared-statement reuse. pos is BIGINT in PG.
    const chrs = variantKeys.map((key) => key.chr)
    const positions = variantKeys.map((key) => key.pos)
    const refs = variantKeys.map((key) => key.ref)
    const alts = variantKeys.map((key) => key.alt)

    // Global lookup — always runs (1 named query, fixed text).
    const globalResult = await runNamed(this.pool as Pool, {
      name: 'annotations:get_batch_global:v1',
      text: `
        SELECT va.*
        FROM UNNEST($1::text[], $2::bigint[], $3::text[], $4::text[]) AS k(chr, pos, ref, alt)
        INNER JOIN ${schemaName}."variant_annotations" va
          ON va.chr = k.chr
         AND va.pos = k.pos
         AND va.ref = k.ref
         AND va.alt = k.alt
      `,
      values: [chrs, positions, refs, alts],
      schema: this.schema
    })
    for (const row of globalResult.rows) {
      const global = toGlobalAnnotation(row)
      annotations[variantKey(global)].global = global
    }

    // Per-case lookup — only when caseId !== null (2nd query, fixed text).
    if (caseId === null) return annotations

    // The defensive join on BOTH cva.case_id AND v.case_id rejects any spoofed
    // variantId crossing a case boundary (Pass-8 #2). The cardinality($6) = 0
    // short-circuit lets the single named SQL text serve both the with-variantId
    // and coords-only paths.
    const variantIds = variantKeys
      .map((key) => key.variantId)
      .filter((value): value is number => typeof value === 'number')
    const perCaseResult = await runNamed(this.pool as Pool, {
      name: 'annotations:get_batch_per_case:v1',
      text: `
        SELECT
          k.chr AS key_chr,
          k.pos AS key_pos,
          k.ref AS key_ref,
          k.alt AS key_alt,
          cva.*
        FROM UNNEST($2::text[], $3::bigint[], $4::text[], $5::text[]) AS k(chr, pos, ref, alt)
        INNER JOIN ${schemaName}."variants" v
          ON v.case_id = $1
         AND v.chr = k.chr
         AND v.pos = k.pos
         AND v.ref = k.ref
         AND v.alt = k.alt
         AND (cardinality($6::int[]) = 0 OR v.id = ANY ($6::int[]))
        INNER JOIN ${schemaName}."case_variant_annotations" cva
          ON cva.case_id = $1
         AND cva.variant_id = v.id
      `,
      values: [caseId, chrs, positions, refs, alts, variantIds],
      schema: this.schema
    })
    for (const row of perCaseResult.rows) {
      const key = variantKey({
        chr: String(row.key_chr),
        pos: toNumber(row.key_pos),
        ref: String(row.key_ref),
        alt: String(row.key_alt)
      })
      annotations[key].perCase = toPerCaseAnnotation(row)
    }

    return annotations
  }
}
