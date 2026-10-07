import type { Pool, PoolClient } from 'pg'

import {
  canonicalizeTranscriptSemantics,
  type TranscriptAnnotation,
  type TranscriptInsertRow
} from '../../../shared/types/transcript'
import { impactRank } from '../../../shared/config/severity.config'
import { addVariantToGeneSummary, beginVariantGeneChange } from './cohort-gene-summary-sql'
import { lockSummaryForWrite, lockSummaryForWriteWithin } from './cohort-summary-lock'
import { recomputeSummaryForVariant } from './cohort-summary-representative-sql'
import { requestSummaryRebuildForVariant } from './cohort-summary-state-sql'
import { quoteIdentifier } from './identifiers'

type QueryablePool = Pick<Pool, 'query'> & Partial<Pick<Pool, 'connect'>>

function toNumber(value: unknown): number {
  if (typeof value === 'number') return value
  if (typeof value === 'bigint') return Number(value)
  if (typeof value === 'string') return Number(value)
  return 0
}

function toBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value === 1
  if (typeof value === 'bigint') return value === 1n
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    return normalized === 't' || normalized === 'true' || normalized === '1'
  }
  return false
}

function toNullableBoolean(value: unknown): boolean | null {
  if (value === null || value === undefined) return null
  return toBoolean(value)
}

/** How long a transcript switch waits for the summary write lock before deferring. */
const SUMMARY_LOCK_WAIT_MS = 5_000

const transcriptColumns = `
  id, variant_id, transcript_id, gene_symbol, consequence, func, cdna, aa_change,
  hpo_sim_score, moi, is_selected, is_mane_select, is_canonical
`

export class PostgresTranscriptsRepository {
  private readonly schemaName: string

  private readonly summaryLockWaitMs: number

  constructor(
    private readonly pool: QueryablePool,
    private readonly schema: string,
    options: { summaryLockWaitMs?: number } = {}
  ) {
    this.schemaName = quoteIdentifier(schema)
    this.summaryLockWaitMs = options.summaryLockWaitMs ?? SUMMARY_LOCK_WAIT_MS
  }

  /**
   * First thing in the transaction, before any row is locked: try to get the
   * summary write lock, for a bounded time. A transcript switch is a user
   * action; it must not queue behind a rebuild or a batch of publications,
   * which can hold the lock for minutes.
   */
  private async lockSummaryBriefly(client: Pick<PoolClient, 'query'>): Promise<boolean> {
    return lockSummaryForWriteWithin(client, this.schema, this.summaryLockWaitMs)
  }

  async list(variantId: number): Promise<TranscriptAnnotation[]> {
    const result = await this.pool.query(
      `SELECT ${transcriptColumns}
         FROM ${this.schemaName}.variant_transcripts
        WHERE variant_id = $1
        ORDER BY is_selected DESC, transcript_id ASC`,
      [variantId]
    )
    return result.rows.map((row) => this.toTranscriptAnnotation(row))
  }

  async switchSelectedTranscript(
    variantId: number,
    transcriptId: string
  ): Promise<{ success: true }> {
    const client = await this.connect()
    try {
      await client.query('BEGIN')
      const summaryLocked = await this.lockSummaryBriefly(client)
      await client.query(
        `UPDATE ${this.schemaName}.variant_transcripts SET is_selected = 0 WHERE variant_id = $1`,
        [variantId]
      )
      const selectedRow = await this.selectTranscript(client, variantId, transcriptId)
      await this.updateVariantFromSelectedTranscript(client, variantId, selectedRow, summaryLocked)
      await client.query('COMMIT')
      return { success: true }
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async insertTranscriptAndSwitch(
    variantId: number,
    transcript: TranscriptInsertRow
  ): Promise<{ success: true }> {
    const client = await this.connect()
    try {
      await client.query('BEGIN')
      const summaryLocked = await this.lockSummaryBriefly(client)
      await client.query(
        `INSERT INTO ${this.schemaName}.variant_transcripts
           (variant_id, transcript_id, gene_symbol, consequence, func, cdna, aa_change,
            hpo_sim_score, moi, is_selected, is_mane_select, is_canonical)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 0, NULL, NULL)
         ON CONFLICT (variant_id, transcript_id)
         DO NOTHING`,
        [
          variantId,
          transcript.transcript_id,
          transcript.gene_symbol,
          transcript.consequence,
          transcript.func,
          transcript.cdna,
          transcript.aa_change,
          transcript.hpo_sim_score,
          transcript.moi
        ]
      )
      await client.query(
        `UPDATE ${this.schemaName}.variant_transcripts SET is_selected = 0 WHERE variant_id = $1`,
        [variantId]
      )
      const selectedRow = await this.selectTranscript(client, variantId, transcript.transcript_id)
      await this.updateVariantFromSelectedTranscript(client, variantId, selectedRow, summaryLocked)
      await client.query('COMMIT')
      return { success: true }
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  private async selectTranscript(
    client: Pick<PoolClient, 'query'>,
    variantId: number,
    transcriptId: string
  ): Promise<Record<string, unknown>> {
    const selected = await client.query(
      `UPDATE ${this.schemaName}.variant_transcripts
          SET is_selected = 1
        WHERE variant_id = $1 AND transcript_id = $2
        RETURNING ${transcriptColumns}`,
      [variantId, transcriptId]
    )
    const selectedRow = selected.rows[0]
    if (selectedRow === undefined) {
      throw new Error(`Transcript ${transcriptId} not found for variant ${variantId}`)
    }
    return selectedRow
  }

  private async updateVariantFromSelectedTranscript(
    client: Pick<PoolClient, 'query'>,
    variantId: number,
    transcript: Record<string, unknown>,
    summaryLocked: boolean
  ): Promise<void> {
    // The cohort summary keeps one representative annotation per coordinate
    // (its most severe carrier row) and the per-gene aggregates count this
    // row under its gene. Both change with the selected transcript. With the
    // summary write lock they are maintained here, in the transaction of the
    // variant update. Without it (somebody holds it for longer than a user
    // should wait) the variant is updated all the same and a rebuild is
    // requested: the cohort view reports the summary as stale until then.
    const geneScope = { schema: this.schema, client, variantId }
    const geneChanges =
      summaryLocked &&
      (await beginVariantGeneChange(
        { ...geneScope, nextGeneSymbol: (transcript.gene_symbol as string | null) ?? null },
        lockSummaryForWrite
      ))

    await this.writeSelectedTranscriptToVariant(client, variantId, transcript)

    if (!summaryLocked) {
      await requestSummaryRebuildForVariant({
        ...geneScope,
        reason: `transcript_switch_variant_${variantId}`
      })
      return
    }
    if (geneChanges) await addVariantToGeneSummary(geneScope)
    await recomputeSummaryForVariant(geneScope)
  }

  private async writeSelectedTranscriptToVariant(
    client: Pick<PoolClient, 'query'>,
    variantId: number,
    transcript: Record<string, unknown>
  ): Promise<void> {
    const semantics = canonicalizeTranscriptSemantics(
      (transcript.consequence as string | null | undefined) ?? null,
      (transcript.func as string | null | undefined) ?? null
    )
    await client.query(
      `UPDATE ${this.schemaName}.variants
          SET transcript = $2,
              gene_symbol = $3,
              consequence = $4,
              func = $5,
              cdna = $6,
              aa_change = $7,
              hpo_sim_score = $8,
              moi = $9,
              impact_rank = $10
        WHERE id = $1`,
      [
        variantId,
        transcript.transcript_id,
        transcript.gene_symbol,
        semantics.consequence,
        semantics.func,
        transcript.cdna,
        transcript.aa_change,
        transcript.hpo_sim_score,
        transcript.moi,
        // The stored rank must describe the stored impact (#469).
        impactRank(semantics.consequence)
      ]
    )
  }

  private async connect(): Promise<PoolClient> {
    if (this.pool.connect === undefined) {
      throw new Error('Postgres transcript writes require a transaction-capable pool')
    }
    return await this.pool.connect()
  }

  private toTranscriptAnnotation(row: Record<string, unknown>): TranscriptAnnotation {
    return {
      id: toNumber(row.id),
      variant_id: toNumber(row.variant_id),
      transcript_id: row.transcript_id as string,
      gene_symbol: (row.gene_symbol as string | null) ?? null,
      consequence: (row.consequence as string | null) ?? null,
      func: (row.func as string | null) ?? null,
      cdna: (row.cdna as string | null) ?? null,
      aa_change: (row.aa_change as string | null) ?? null,
      hpo_sim_score: (row.hpo_sim_score as number | null) ?? null,
      moi: (row.moi as string | null) ?? null,
      is_selected: toBoolean(row.is_selected),
      is_mane_select: toNullableBoolean(row.is_mane_select),
      is_canonical: toNullableBoolean(row.is_canonical)
    }
  }
}
