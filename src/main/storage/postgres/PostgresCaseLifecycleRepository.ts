import type { Pool, PoolClient } from 'pg'

import { InvalidParametersError } from '../../ipc/errors'
import { applyAnnotationFlagsOnCaseDelete } from './cohort-annotation-flags-sql'
import { removeCaseFromGeneSummary } from './cohort-gene-summary-sql'
import { quoteIdentifier } from './identifiers'
import {
  PostgresCohortSummaryRepository,
  SCOPED_DEDUPED_AGG_SQL
} from './PostgresCohortSummaryRepository'
import { lockSummaryForWrite } from './cohort-summary-lock'

/** The subset of PostgresCohortSummaryRepository this repo drives (test seam). */
type CohortSummaryMaintenance = Pick<PostgresCohortSummaryRepository, 'removeColumnMetas'>

type LifecyclePool = Pick<Pool, 'connect' | 'query'>

export const DEFAULT_CASE_DELETE_BATCH_SIZE = 5000

export type CaseDeletionPhase = 'hiding' | 'purging' | 'finalizing'

export interface CaseDeletionProgress {
  phase: CaseDeletionPhase
  /** Variant rows purged so far (purging phase). */
  done: number
  /** Variant rows the case held when it was hidden, if known. */
  total: number | null
}

export interface HideCaseResult {
  /** 'hidden' = this call hid it; 'resume' = already 'deleting'; 'missing' = no row. */
  state: 'hidden' | 'resume' | 'missing'
  genomeBuild?: string
  variantCount: number
}

export interface CaseDeletionOptions {
  batchSize?: number
  onProgress?: (progress: CaseDeletionProgress) => void
  /** Yield between purge batches so request traffic gets pool connections. */
  pauseBetweenBatchesMs?: number
  /**
   * Checked between purge batches. An aborted deletion leaves the case in
   * 'deleting' (invisible to readers) and is resumed at the next start.
   */
  signal?: AbortSignal
}

export type CaseLifecycleStatus = 'ready' | 'importing' | 'deleting'

/**
 * statement_timeout for the case-scoped maintenance transaction. It only
 * takes row locks (readers never wait on it), but a WGS-sized case's summary
 * subtraction can exceed the pool's 30 s default.
 */
const MAINTENANCE_STATEMENT_TIMEOUT_MS = 10 * 60 * 1000

export class CaseDeletionInterruptedError extends Error {
  constructor(caseId: number) {
    super(`deletion of case ${caseId} was interrupted; it resumes at the next start`)
    this.name = 'CaseDeletionInterruptedError'
  }
}

const DELETING_NAME_PREFIX = '__deleting__:'

/**
 * Case deletion without global locks (2026-10 blocking audit, W-1).
 *
 * The old single-transaction delete TRUNCATEd and rebuilt `variant_frequency`
 * (ACCESS EXCLUSIVE: every `variants:query` joins it, so every web user
 * blocked) and cascade-deleted the whole case in one statement. Now:
 *
 *   1. `hideCase` — ONE short transaction, row locks only: annotation flags,
 *      cohort-summary carrier/het/hom subtraction, zero-carrier cleanup and
 *      the variant_frequency decrement are all scoped to the case's own
 *      coordinates; column metas are dropped; the row is renamed (freeing the
 *      UNIQUE name for re-import) and flipped to import_status='deleting'.
 *      The `cases` / `variants` views (migration 0015) hide it from every
 *      reader at commit. Doing the summary maths in the same transaction as
 *      the flip keeps a concurrent full summary rebuild (which reads the
 *      views) from double-counting the subtraction.
 *      Cohort frequency needs no maintenance: readers divide by the visible
 *      cases of the build, which no longer include this one.
 *   2. `purgeCaseVariants` — DELETE variants_all in `batchSize` chunks, each
 *      its own short transaction; FK cascades remove transcripts / SV / CNV /
 *      STR / per-case annotation rows per chunk.
 *   3. `finalizeCaseDeletion` — delete the (now small) cases_all row.
 *
 * Steps 2-3 are idempotent, so a crash after step 1 is resumed by
 * `listPendingDeletions()` + `deleteCase()` at the next start.
 */
export class PostgresCaseLifecycleRepository {
  private readonly schemaName: string
  private readonly summary: CohortSummaryMaintenance

  constructor(
    private readonly pool: LifecyclePool,
    private readonly schema: string,
    summary?: CohortSummaryMaintenance
  ) {
    this.schemaName = quoteIdentifier(schema)
    this.summary = summary ?? new PostgresCohortSummaryRepository()
  }

  /** Run (or resume) the full deletion and resolve when the case is gone. */
  async deleteCase(caseId: number, options: CaseDeletionOptions = {}): Promise<void> {
    options.onProgress?.({ phase: 'hiding', done: 0, total: null })
    const hidden = await this.hideCase(caseId)
    if (hidden.state === 'missing') return
    await this.completeHiddenDeletion(caseId, hidden, options)
  }

  /** Steps 2-3 for a case already flipped to 'deleting'. */
  async completeHiddenDeletion(
    caseId: number,
    hidden: Pick<HideCaseResult, 'genomeBuild' | 'variantCount'>,
    options: CaseDeletionOptions = {}
  ): Promise<void> {
    const total = hidden.variantCount > 0 ? hidden.variantCount : null
    options.onProgress?.({ phase: 'purging', done: 0, total })
    const purged = await this.purgeCaseVariants(caseId, options, total)
    options.onProgress?.({ phase: 'finalizing', done: purged, total })
    await this.finalizeCaseDeletion(caseId)
  }

  /** Lifecycle status of a case row (including hidden ones), or undefined. */
  async getCaseStatus(caseId: number): Promise<CaseLifecycleStatus | undefined> {
    const result = await this.pool.query<{ import_status: CaseLifecycleStatus }>(
      `SELECT import_status FROM ${this.tbl('cases_all')} WHERE id = $1`,
      [caseId]
    )
    return result.rows[0]?.import_status
  }

  async hideCase(caseId: number): Promise<HideCaseResult> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(`SET LOCAL statement_timeout = ${MAINTENANCE_STATEMENT_TIMEOUT_MS}`)
      const row = await client.query<{
        genome_build: string
        import_status: string
        variant_count: string | number
      }>(
        `SELECT genome_build, import_status, variant_count
           FROM ${this.tbl('cases_all')} WHERE id = $1 FOR UPDATE`,
        [caseId]
      )
      const current = row.rows[0]
      if (current === undefined) {
        await client.query('COMMIT')
        return { state: 'missing', variantCount: 0 }
      }
      const variantCount = Number(current.variant_count ?? 0)
      if (current.import_status === 'deleting') {
        await client.query('COMMIT')
        return { state: 'resume', genomeBuild: current.genome_build, variantCount }
      }
      if (current.import_status !== 'ready') {
        throw new InvalidParametersError(
          `case ${caseId} cannot be deleted while import_status=${current.import_status}`,
          'This case is still being imported. Delete it after the import finishes.'
        )
      }

      // One writer of the derived cohort tables at a time; an import that is
      // publishing finishes within seconds, so wait for it rather than fail.
      await client.query('SET LOCAL lock_timeout = 0')
      await lockSummaryForWrite(client, this.schema)
      await this.applyCaseScopedMaintenance(client, caseId)
      await client.query(
        `UPDATE ${this.tbl('cases_all')}
            SET import_status = 'deleting',
                name = $2::text || id::text || ':' || name
          WHERE id = $1`,
        [caseId, DELETING_NAME_PREFIX]
      )
      await client.query('COMMIT')
      return { state: 'hidden', genomeBuild: current.genome_build, variantCount }
    } catch (error) {
      await rollbackQuietly(client)
      throw error
    } finally {
      client.release()
    }
  }

  async purgeCaseVariants(
    caseId: number,
    options: CaseDeletionOptions = {},
    total: number | null = null
  ): Promise<number> {
    const batchSize = Math.max(1, options.batchSize ?? DEFAULT_CASE_DELETE_BATCH_SIZE)
    let purged = 0
    for (;;) {
      if (options.signal?.aborted === true) throw new CaseDeletionInterruptedError(caseId)
      const result = await this.pool.query(
        `WITH doomed AS (
           SELECT id FROM ${this.tbl('variants_all')} WHERE case_id = $1 LIMIT $2
         )
         DELETE FROM ${this.tbl('variants_all')} v USING doomed d WHERE v.id = d.id`,
        [caseId, batchSize]
      )
      const deleted = result.rowCount ?? 0
      purged += deleted
      if (deleted > 0) options.onProgress?.({ phase: 'purging', done: purged, total })
      if (deleted < batchSize) return purged
      await pause(options.pauseBetweenBatchesMs ?? 0)
    }
  }

  async finalizeCaseDeletion(caseId: number): Promise<void> {
    // Remaining children (metadata, comments, links, column metas) are small;
    // the cascade from this single row is cheap once variants are gone.
    await this.pool.query(
      `DELETE FROM ${this.tbl('cases_all')} WHERE id = $1 AND import_status = 'deleting'`,
      [caseId]
    )
  }

  /** Ids of every visible ('ready') case, oldest first. */
  async listReadyCaseIds(): Promise<number[]> {
    const result = await this.pool.query<{ id: string | number }>(
      `SELECT id FROM ${this.tbl('cases_all')} WHERE import_status = 'ready' ORDER BY id`
    )
    return result.rows.map((row) => Number(row.id))
  }

  /** Case ids left in 'deleting' (crash or shutdown mid-purge), oldest first. */
  async listPendingDeletions(): Promise<
    Array<{ caseId: number; genomeBuild: string; variantCount: number }>
  > {
    const result = await this.pool.query<{
      id: string | number
      genome_build: string
      variant_count: string | number
    }>(
      `SELECT id, genome_build, variant_count FROM ${this.tbl('cases_all')}
        WHERE import_status = 'deleting' ORDER BY id`
    )
    return result.rows.map((row) => ({
      caseId: Number(row.id),
      genomeBuild: row.genome_build,
      variantCount: Number(row.variant_count ?? 0)
    }))
  }

  private async applyCaseScopedMaintenance(
    client: Pick<PoolClient, 'query'>,
    caseId: number
  ): Promise<void> {
    // Annotation flags: only coordinates where THIS case carried a per-case
    // annotation can change; the hook excludes the case via v.case_id <> $1.
    await applyAnnotationFlagsOnCaseDelete(client as unknown as Pool, {
      schema: this.schema,
      deletedCaseId: caseId
    })

    // Subtract carrier/het/hom together from the deduped per-case CTE (one
    // carrier per coordinate per case — symmetric with incrementalAdd).
    const tbl = (t: string): string => this.tbl(t)
    await client.query(
      `
      ${SCOPED_DEDUPED_AGG_SQL(tbl)}
      UPDATE ${tbl('cohort_variant_summary')} cvs
      SET carrier_count = cvs.carrier_count - per_case.carrier_delta,
          het_count = cvs.het_count - per_case.het_delta,
          hom_count = cvs.hom_count - per_case.hom_delta
      FROM per_case
      WHERE cvs.chr = per_case.chr AND cvs.pos = per_case.pos
        AND cvs.ref = per_case.ref AND cvs.alt = per_case.alt
        AND cvs.variant_type = per_case.variant_type
        AND cvs.genome_build = per_case.genome_build
      `,
      [caseId]
    )

    // Zero-carrier cleanup scoped to this case's coordinates (no full scan).
    await client.query(
      `DELETE FROM ${tbl('cohort_variant_summary')} cvs
        USING (
          SELECT DISTINCT chr, pos, ref, alt, variant_type
            FROM ${tbl('variants_all')} WHERE case_id = $1
        ) touched
        WHERE cvs.chr = touched.chr AND cvs.pos = touched.pos
          AND cvs.ref = touched.ref AND cvs.alt = touched.alt
          AND cvs.variant_type = touched.variant_type
          AND cvs.carrier_count <= 0`,
      [caseId]
    )

    // Per-gene aggregates: subtract the case while its rows are still visible.
    await removeCaseFromGeneSummary({ schema: this.schema, client, caseId })

    // variant_frequency: symmetric decrement of rebuildVariantFrequencyForCase
    // (one count per distinct coordinate per case) — replaces TRUNCATE+rebuild.
    const caseCoords = `SELECT DISTINCT coord_hash FROM ${tbl('variants_all')} WHERE case_id = $1`
    await client.query(
      `UPDATE ${tbl('variant_frequency')} vf
          SET case_count = vf.case_count - 1
         FROM (${caseCoords}) coords
        WHERE vf.coord_hash = coords.coord_hash`,
      [caseId]
    )
    await client.query(
      `DELETE FROM ${tbl('variant_frequency')} vf
        USING (${caseCoords}) coords
        WHERE vf.coord_hash = coords.coord_hash AND vf.case_count <= 0`,
      [caseId]
    )

    await this.summary.removeColumnMetas({
      schema: this.schema,
      client: client as unknown as PoolClient,
      caseId
    })
  }

  private tbl(table: string): string {
    return `${this.schemaName}."${table}"`
  }
}

async function rollbackQuietly(client: Pick<PoolClient, 'query'>): Promise<void> {
  try {
    await client.query('ROLLBACK')
  } catch {
    // Preserve the original failure for callers.
  }
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => (ms > 0 ? setTimeout(resolve, ms) : setImmediate(resolve)))
}
