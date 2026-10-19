import type { Pool, PoolClient } from 'pg'

import type { BatchAnnotationKey } from '../../../shared/types/api'
import type { CaseVariantAnnotation, VariantAnnotation } from '../../../shared/types/database'
import {
  assertOverrideReason,
  globalAnnotationAuditEntries,
  perCaseAnnotationAuditEntries
} from '../annotation-audit'
import {
  applyAnnotationFlagsGlobal,
  applyAnnotationFlagsPerCase,
  beginAnnotationWrite
} from './cohort-annotation-flags-sql'
import { quoteIdentifier, toNumber } from './identifiers'
// A failed ROLLBACK leaves the summary write lock held: release(failure) destroys the connection.
import { runOrDestroy } from './long-running-client'
import { runNamed } from './named-query'
import { PostgresAuditLogRepository } from './PostgresAuditLogRepository'

type QueryablePool = Pick<Pool, 'query'>
type TransactionCapablePool = QueryablePool & { connect: () => Promise<PoolClient> }

import {
  type GlobalAnnotationUpdates,
  type PerCaseAnnotationUpdates,
  type GlobalKey,
  nowExpression,
  toStarredNumber,
  toGlobalAnnotation,
  toPerCaseAnnotation,
  variantKey,
  acquireAnnotationWriteLocks,
  buildGlobalLockAndGetSql,
  buildPerCaseLockAndGetSql,
  buildGlobalUpsertSql,
  buildPerCaseUpsertSql,
  buildGlobalDeleteSql,
  buildPerCaseDeleteSql
} from './postgres-annotations-types'

export class PostgresAnnotationsRepository {
  constructor(
    private readonly pool: QueryablePool,
    private readonly schema: string,
    private readonly summaryLockWaitMs?: number
  ) {}

  private async _withWriteTransaction<T>(
    lockKeys: string[],
    fn: (client: PoolClient, flags: Awaited<ReturnType<typeof beginAnnotationWrite>>) => Promise<T>
  ): Promise<T> {
    const sortedKeys = Array.from(new Set(lockKeys)).sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true })
    )
    const releaseLocks = await acquireAnnotationWriteLocks(this.pool, this.schema, sortedKeys)
    let client: PoolClient | undefined
    let rollbackFailure: Error | undefined
    try {
      client = await this.connect()
      const flags = await beginAnnotationWrite(client, this.schema, this.summaryLockWaitMs)
      if (sortedKeys.length > 0) {
        await client.query(
          'SELECT pg_advisory_xact_lock(hashtext($1::text), hashtext(k)) FROM unnest($2::text[]) AS k',
          [this.schema, sortedKeys]
        )
      }
      const result = await fn(client, flags)
      await client.query('COMMIT')
      return result
    } catch (error) {
      if (client) {
        rollbackFailure = await runOrDestroy(client, 'ROLLBACK')
      }
      throw error
    } finally {
      try {
        client?.release(rollbackFailure)
      } finally {
        releaseLocks()
      }
    }
  }

  async getGlobalAnnotation(
    chr: string,
    pos: number,
    ref: string,
    alt: string,
    genomeBuild: string
  ): Promise<VariantAnnotation | null> {
    const schemaName = quoteIdentifier(this.schema)
    const result = await this.pool.query(
      `
        SELECT *
        FROM ${schemaName}."variant_annotations"
        WHERE chr = $1 AND pos = $2 AND ref = $3 AND alt = $4 AND genome_build = $5
        LIMIT 1
      `,
      [chr, pos, ref, alt, genomeBuild]
    )

    const row = result.rows[0]
    return row === undefined ? null : toGlobalAnnotation(row)
  }

  private async _lockAndGetGlobalAnnotation(
    client: QueryablePool,
    { chr, pos, ref, alt, genomeBuild }: GlobalKey
  ): Promise<VariantAnnotation | null> {
    const result = await client.query(buildGlobalLockAndGetSql(quoteIdentifier(this.schema)), [
      chr,
      pos,
      ref,
      alt,
      genomeBuild
    ])
    const row = result.rows[0]
    return row === undefined ? null : toGlobalAnnotation(row)
  }

  async upsertGlobalAnnotation(
    chr: string,
    pos: number,
    ref: string,
    alt: string,
    genomeBuild: string,
    updates: GlobalAnnotationUpdates
  ): Promise<VariantAnnotation> {
    const key = { chr, pos, ref, alt, genomeBuild }
    return this._withWriteTransaction(
      [`global:${genomeBuild}:${chr}:${pos}:${ref}:${alt}`],
      async (client, flags) => {
        const result = await this._upsertGlobalAnnotationOn(client, key, updates)
        await applyAnnotationFlagsGlobal(client, { ...flags, ...key })
        return result
      }
    )
  }

  // Raw-SQL helper — operates on the passed client/pool, no BEGIN/COMMIT.
  // Public wrapper and *WithAudit transactions both route through here so the
  // upsert never opens its own transaction (would nest under audit's BEGIN).
  private async _upsertGlobalAnnotationOn(
    client: QueryablePool,
    { chr, pos, ref, alt, genomeBuild }: GlobalKey,
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
      acmgEvidenceProvided,
      genomeBuild
    ]

    const result = await runNamed(client as Pool, {
      name: 'annotations:upsert_global:v2',
      text: buildGlobalUpsertSql(schemaName),
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
    genomeBuild: string,
    updates: GlobalAnnotationUpdates & { user_name?: string | null }
  ): Promise<VariantAnnotation> {
    const key = { chr, pos, ref, alt, genomeBuild }
    return this._withWriteTransaction(
      [`global:${genomeBuild}:${chr}:${pos}:${ref}:${alt}`],
      async (client, flags) => {
        const audit = new PostgresAuditLogRepository(client, this.schema)
        const oldAnnotation = await this._lockAndGetGlobalAnnotation(client, key)
        assertOverrideReason(updates, oldAnnotation as Record<string, unknown> | null)
        const result = await this._upsertGlobalAnnotationOn(client, key, updates)
        for (const entry of globalAnnotationAuditEntries(
          { chr, pos, ref, alt, genome_build: genomeBuild },
          updates,
          oldAnnotation as Record<string, unknown> | null
        )) {
          await audit.append(entry)
        }
        await applyAnnotationFlagsGlobal(client, { ...flags, ...key })
        return result
      }
    )
  }

  async deleteGlobalAnnotation(
    chr: string,
    pos: number,
    ref: string,
    alt: string,
    genomeBuild: string
  ): Promise<void> {
    const key = { chr, pos, ref, alt, genomeBuild }
    await this._withWriteTransaction(
      [`global:${genomeBuild}:${chr}:${pos}:${ref}:${alt}`],
      async (client, flags) => {
        await this._deleteGlobalAnnotationOn(client, key)
        await applyAnnotationFlagsGlobal(client, { ...flags, ...key })
      }
    )
  }

  // Raw-SQL helper — operates on the passed client/pool, no BEGIN/COMMIT.
  private async _deleteGlobalAnnotationOn(
    client: QueryablePool,
    { chr, pos, ref, alt, genomeBuild }: GlobalKey
  ): Promise<void> {
    await runNamed(client as Pool, {
      name: 'annotations:delete_global:v2',
      text: buildGlobalDeleteSql(quoteIdentifier(this.schema)),
      values: [chr, pos, ref, alt, genomeBuild],
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

  private async _lockAndGetPerCaseAnnotation(
    client: QueryablePool,
    caseId: number,
    variantId: number
  ): Promise<CaseVariantAnnotation | null> {
    const result = await client.query(buildPerCaseLockAndGetSql(quoteIdentifier(this.schema)), [
      caseId,
      variantId
    ])
    const row = result.rows[0]
    return row === undefined ? null : toPerCaseAnnotation(row)
  }

  async upsertPerCaseAnnotation(
    caseId: number,
    variantId: number,
    updates: PerCaseAnnotationUpdates
  ): Promise<CaseVariantAnnotation> {
    return this._withWriteTransaction([`case:${caseId}:${variantId}`], async (client, flags) => {
      const result = await this._upsertPerCaseAnnotationOn(client, caseId, variantId, updates)
      await applyAnnotationFlagsPerCase(client, { ...flags, caseId, variantId })
      return result
    })
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
      text: buildPerCaseUpsertSql(schemaName),
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
    return this._withWriteTransaction([`case:${caseId}:${variantId}`], async (client, flags) => {
      const audit = new PostgresAuditLogRepository(client, this.schema)
      const oldAnnotation = await this._lockAndGetPerCaseAnnotation(client, caseId, variantId)
      assertOverrideReason(updates, oldAnnotation as Record<string, unknown> | null)
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
      return result
    })
  }

  async batchUpsertPerCaseAnnotationWithAudit(
    caseId: number,
    variantIds: number[],
    updates: PerCaseAnnotationUpdates & { tag_id?: number; user_name?: string | null }
  ): Promise<{ updatedCount: number }> {
    const uniqueIds = Array.from(new Set(variantIds)).sort((a, b) => a - b)
    if (uniqueIds.length === 0) return { updatedCount: 0 }
    return this._withWriteTransaction(
      uniqueIds.map((id) => `case:${caseId}:${id}`),
      async (client, flags) => {
        const schemaName = quoteIdentifier(this.schema)
        const validRows = await client.query<{ id: string | number }>(
          `SELECT id FROM ${schemaName}."variants" WHERE case_id = $1 AND id = ANY($2::bigint[]) ORDER BY id FOR UPDATE`,
          [caseId, uniqueIds]
        )
        const validIds = validRows.rows.map((r) => toNumber(r.id))
        if (validIds.length !== uniqueIds.length) {
          throw new Error(`One or more variants do not belong to case ${caseId}`)
        }

        const audit = new PostgresAuditLogRepository(client, this.schema)
        const hasAnnotationUpdates =
          'starred' in updates ||
          'acmg_classification' in updates ||
          'acmg_evidence' in updates ||
          'per_case_comment' in updates

        const oldAnnotations = new Map<number, CaseVariantAnnotation | null>()
        for (const variantId of uniqueIds) {
          const oldAnnotation = await this._lockAndGetPerCaseAnnotation(client, caseId, variantId)
          assertOverrideReason(updates, oldAnnotation as Record<string, unknown> | null)
          oldAnnotations.set(variantId, oldAnnotation)
        }

        for (const variantId of uniqueIds) {
          const oldAnnotation = oldAnnotations.get(variantId) ?? null
          if (hasAnnotationUpdates) {
            await this._upsertPerCaseAnnotationOn(client, caseId, variantId, updates)
          }
          for (const entry of perCaseAnnotationAuditEntries(
            caseId,
            variantId,
            updates,
            oldAnnotation as Record<string, unknown> | null
          )) {
            await audit.append(entry)
          }
          await applyAnnotationFlagsPerCase(client, { ...flags, caseId, variantId })
        }

        if (updates.tag_id !== undefined) {
          for (const variantId of uniqueIds) {
            await client.query(
              `INSERT INTO ${schemaName}."variant_tags" (case_id, variant_id, tag_id, created_at)
               VALUES ($1, $2, $3, ${nowExpression})
               ON CONFLICT DO NOTHING`,
              [caseId, variantId, updates.tag_id]
            )
          }
        }

        return { updatedCount: uniqueIds.length }
      }
    )
  }

  async deletePerCaseAnnotation(caseId: number, variantId: number): Promise<void> {
    await this._withWriteTransaction([`case:${caseId}:${variantId}`], async (client, flags) => {
      await this._deletePerCaseAnnotationOn(client, caseId, variantId)
      await applyAnnotationFlagsPerCase(client, { ...flags, caseId, variantId })
    })
  }

  // Raw-SQL helper — operates on the passed client/pool, no BEGIN/COMMIT.
  private async _deletePerCaseAnnotationOn(
    client: QueryablePool,
    caseId: number,
    variantId: number
  ): Promise<void> {
    await runNamed(client as Pool, {
      name: 'annotations:delete_per_case:v1',
      text: buildPerCaseDeleteSql(quoteIdentifier(this.schema)),
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
    const caseResult = await this.pool.query(
      `SELECT genome_build FROM ${schemaName}."cases" WHERE id = $1`,
      [caseId]
    )
    const build = caseResult.rows[0]?.genome_build as string | undefined

    const global =
      build === undefined ? null : await this.getGlobalAnnotation(chr, pos, ref, alt, build)
    const variantId = variantResult.rows[0]?.id
    const perCase =
      variantId === undefined || variantId === null
        ? null
        : await this.getPerCaseAnnotation(caseId, toNumber(variantId))

    return { global, perCase }
  }

  private async connect(): Promise<PoolClient> {
    const pool = this.pool as Partial<TransactionCapablePool>
    if (pool.connect === undefined) {
      throw new Error('Postgres annotation audit writes require a transaction-capable pool')
    }
    return await pool.connect()
  }

  /** Global rows of the case's build; without a case, of `genomeBuild` (#577). */
  async getBatch(
    caseId: number | null,
    variantKeys: BatchAnnotationKey[],
    genomeBuild: string | null = null
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
      name: 'annotations:get_batch_global:v2',
      text: `
        SELECT va.*
        FROM UNNEST($1::text[], $2::bigint[], $3::text[], $4::text[]) AS k(chr, pos, ref, alt)
        INNER JOIN ${schemaName}."variant_annotations" va
          ON va.chr = k.chr
         AND va.pos = k.pos
         AND va.ref = k.ref
         AND va.alt = k.alt
         AND va.genome_build = CASE WHEN $5::bigint IS NULL THEN $6::text
           ELSE (SELECT c.genome_build FROM ${schemaName}."cases" c WHERE c.id = $5::bigint) END
      `,
      values: [chrs, positions, refs, alts, caseId, genomeBuild],
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
