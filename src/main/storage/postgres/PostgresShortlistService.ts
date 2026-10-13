import type { Pool, PoolClient } from 'pg'

import { DatabaseError, NotFoundError } from '../../database/errors'
import {
  normalizeTieBreakerKey,
  throwShortlistQueryErrors,
  type GetShortlistParams
} from '../../database/ShortlistService'
import {
  SHORTLIST_PAGE_SIZE,
  toShortlistCandidate,
  toShortlistVariantFilter
} from '../../database/shortlist-query'
import { ShortlistConfigSchema } from '../../../shared/types/ipc-schemas'
import type { FilterPreset } from '../../../shared/types/filter-presets'
import type { Variant } from '../../../shared/types/database'
import type { FilterState } from '../../../shared/types/filters'
import type { CaseInfo } from '../../services/scoring/evidence'
import type {
  ScoredCandidate,
  ShortlistCandidate,
  ShortlistConfig,
  ShortlistResult,
  ShortlistRow,
  VariantTypeKey
} from '../../../shared/types/shortlist'
import { mergeTopScored, scoreRow } from '../../services/scoring'
import { GeneContextBuilder } from '../../services/scoring/evidence'
import { scoreEvidencePage, toLightRow } from '../../services/scoring/evidence/rank-page'
import { compileEvidenceConfig, toCaseInfo } from '../../database/shortlist-evidence'
import { liftClientQueryTimeout, runOrDestroy } from './long-running-client'
import type { PostgresFilterPresetsRepository } from './PostgresFilterPresetsRepository'
import type { PostgresExportRepository } from './PostgresExportRepository'
import { normalizeVariantRow } from './PostgresVariantReadRepository'
import { quoteIdentifier } from './identifiers'

interface PostgresShortlistServiceOptions {
  pool: Pick<Pool, 'query' | 'connect'>
  schema: string
  filterPresets: Pick<PostgresFilterPresetsRepository, 'getPreset'>
  rows: Pick<PostgresExportRepository, 'streamVariantRows' | 'variantRowsQuery'>
}

type Queryable = Pick<PoolClient, 'query'>
type ScopedQuery = { type: VariantTypeKey; sql: string; params: unknown[] }

/**
 * Per-statement bound inside the evidence snapshot; the pool's 30 s default
 * could cut the first FETCH (the sort) of a large case, which the legacy
 * stream path never had to meet.
 */
const SNAPSHOT_STATEMENT_TIMEOUT_MS = 5 * 60 * 1000

function toError(value: unknown): Error {
  if (value instanceof Error) return value
  return new Error(typeof value === 'string' ? value : JSON.stringify(value))
}

export class PostgresShortlistService {
  private readonly schemaName: string

  constructor(private readonly options: PostgresShortlistServiceOptions) {
    this.schemaName = quoteIdentifier(options.schema)
  }

  async getShortlist(params: GetShortlistParams): Promise<ShortlistResult> {
    const started = Date.now()
    const { config: resolvedConfig, presetUsed } = await this.resolveConfig(params)
    const config: ShortlistConfig =
      resolvedConfig.tieBreakers != null && resolvedConfig.tieBreakers.length > 0
        ? {
            ...resolvedConfig,
            tieBreakers: resolvedConfig.tieBreakers.map((tb) => ({
              ...tb,
              key: normalizeTieBreakerKey(tb.key)
            }))
          }
        : resolvedConfig

    const { kept, totalCandidates } =
      config.rankConfig.ruleset != null
        ? await this.rankEvidence(params.caseId, config, presetUsed?.name ?? null)
        : await this.rankLegacy(params.caseId, config)

    const rows: ShortlistRow[] = kept.map((row, index) => ({ ...row, rank: index + 1 }))

    const elapsedMs = Date.now() - started
    return {
      rows,
      totalCandidates,
      presetUsed,
      elapsedMs
    }
  }

  private async rankLegacy(
    caseId: number,
    config: ShortlistConfig
  ): Promise<{ kept: ScoredCandidate[]; totalCandidates: number }> {
    const scope = config.variantTypeScope ?? (await this.detectPresentTypes(caseId))
    let kept: ScoredCandidate[] = []
    let totalCandidates = 0
    const queryErrors: Array<{ type: VariantTypeKey; error: Error }> = []

    let starredVariantIds: Set<number> | null = null
    for (const type of scope) {
      try {
        const mergedFilters: Partial<FilterState> = {
          ...config.baseFilters,
          ...(config.perTypeOverrides?.[type] ?? {})
        }
        const filter = toShortlistVariantFilter(caseId, type, mergedFilters)
        // One streamed scan over every eligible row (id ASC), scored in pages
        // so only the best topN are kept (#537).
        let page: Variant[] = []
        const flush = async (): Promise<void> => {
          if (page.length === 0) return
          totalCandidates += page.length
          starredVariantIds ??= await this.loadStarredVariantIds(caseId, this.options.pool)
          const candidates = this.hydrateCandidates(page, starredVariantIds)
          const scored = candidates.map((row) => ({ ...row, ...scoreRow(row, config.rankConfig) }))
          kept = mergeTopScored(kept, scored, config.topN, config.tieBreakers)
          page = []
        }
        for await (const row of this.options.rows.streamVariantRows(filter)) {
          page.push(normalizeVariantRow(row))
          if (page.length === SHORTLIST_PAGE_SIZE) await flush()
        }
        await flush()
      } catch (error) {
        queryErrors.push({ type, error: toError(error) })
      }
    }

    if (queryErrors.length > 0) throwShortlistQueryErrors(queryErrors, 'postgres shortlist')
    return { kept, totalCandidates }
  }

  /**
   * Two-pass evidence ranking (spec §3.3). Both passes and the starred
   * hydration read one REPEATABLE READ snapshot on one client, so a write
   * between the passes can neither add a row pass 1 never counted nor change
   * a pin.
   */
  private async rankEvidence(
    caseId: number,
    config: ShortlistConfig,
    presetName: string | null
  ): Promise<{ kept: ScoredCandidate[]; totalCandidates: number }> {
    const compiled = compileEvidenceConfig(config, presetName)
    const queries: ScopedQuery[] = []
    const queryErrors: Array<{ type: VariantTypeKey; error: Error }> = []
    // compileEvidenceConfig guarantees a non-empty snv/indel scope.
    for (const type of config.variantTypeScope ?? []) {
      try {
        const filter = toShortlistVariantFilter(caseId, type, {
          ...config.baseFilters,
          ...(config.perTypeOverrides?.[type] ?? {})
        })
        queries.push({ type, ...(await this.options.rows.variantRowsQuery(filter)) })
      } catch (error) {
        queryErrors.push({ type, error: toError(error) })
      }
    }
    if (queryErrors.length > 0) throwShortlistQueryErrors(queryErrors, 'postgres shortlist')

    return this.inSnapshot(async (client) => {
      const info = await this.caseInfo(client, caseId)
      const builder = new GeneContextBuilder(info)
      const starredVariantIds = await this.loadStarredVariantIds(caseId, client)
      let totalCandidates = 0
      await this.forEachPage(client, queries, async (rows) => {
        totalCandidates += rows.length
        builder.add(rows.map(toLightRow))
      })
      const ctx = builder.build()
      let kept: ScoredCandidate[] = []
      await this.forEachPage(client, queries, async (rows) => {
        const candidates = this.hydrateCandidates(rows, starredVariantIds)
        const scored = scoreEvidencePage(candidates, ctx, compiled, config.rankConfig)
        kept = mergeTopScored(kept, scored, config.topN, config.tieBreakers)
      })
      return { kept, totalCandidates }
    })
  }

  /** Run `work` on one client inside a read-only REPEATABLE READ transaction. */
  private async inSnapshot<T>(work: (client: Queryable) => Promise<T>): Promise<T> {
    const client = await this.options.pool.connect()
    const restoreQueryTimeout = liftClientQueryTimeout(client)
    let failure: Error | undefined
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
      await client.query(`SET LOCAL statement_timeout = ${SNAPSHOT_STATEMENT_TIMEOUT_MS}`)
      const result = await work(client)
      await client.query('COMMIT')
      return result
    } catch (error) {
      failure = await runOrDestroy(client, 'ROLLBACK')
      throw error
    } finally {
      restoreQueryTimeout()
      client.release(failure)
    }
  }

  /**
   * Page each query through a server-side cursor. Unlike a row stream, a
   * cursor leaves the client free between FETCHes for the hydration query.
   */
  private async forEachPage(
    client: Queryable,
    queries: readonly ScopedQuery[],
    onPage: (rows: Variant[]) => Promise<void>
  ): Promise<void> {
    for (const { type, sql, params } of queries) {
      try {
        await client.query(`DECLARE shortlist_rows NO SCROLL CURSOR FOR ${sql}`, params)
        for (;;) {
          const { rows } = await client.query<Record<string, unknown>>(
            `FETCH FORWARD ${SHORTLIST_PAGE_SIZE} FROM shortlist_rows`
          )
          if (rows.length > 0) await onPage(rows.map(normalizeVariantRow))
          if (rows.length < SHORTLIST_PAGE_SIZE) break
        }
        await client.query('CLOSE shortlist_rows')
      } catch (error) {
        throwShortlistQueryErrors([{ type, error: toError(error) }], 'postgres shortlist')
      }
    }
  }

  private async caseInfo(client: Queryable, caseId: number): Promise<CaseInfo> {
    const result = await client.query<{ genome_build: string | null; sex: string | null }>(
      `SELECT c.genome_build, cm.sex
       FROM ${this.schemaName}."cases" c
       LEFT JOIN ${this.schemaName}."case_metadata" cm ON cm.case_id = c.id
       WHERE c.id = $1`,
      [caseId]
    )
    return toCaseInfo(result.rows[0]?.genome_build, result.rows[0]?.sex)
  }

  private async resolveConfig(params: GetShortlistParams): Promise<{
    config: ShortlistConfig
    presetUsed: FilterPreset | null
  }> {
    if ('adHocConfig' in params) {
      return { config: params.adHocConfig, presetUsed: null }
    }

    const preset = await this.options.filterPresets.getPreset(params.presetId)
    if (preset == null) {
      throw new NotFoundError('FilterPreset', params.presetId)
    }
    if (preset.kind !== 'shortlist') {
      throw new DatabaseError(
        `Preset "${preset.name}" is not a shortlist preset (kind='${preset.kind}')`
      )
    }

    const nested = (preset.filterJson as unknown as { shortlist?: unknown }).shortlist
    if (nested == null) {
      throw new DatabaseError(
        `Shortlist preset "${preset.name}" is missing filter_json.shortlist payload`
      )
    }

    const parsed = ShortlistConfigSchema.safeParse(nested)
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
        .join('; ')
      throw new DatabaseError(
        `Shortlist preset "${preset.name}" has an invalid filter_json.shortlist payload: ${issues}`
      )
    }

    return { config: parsed.data as ShortlistConfig, presetUsed: preset }
  }

  private async detectPresentTypes(caseId: number): Promise<VariantTypeKey[]> {
    const result = await this.options.pool.query<{ variant_type: VariantTypeKey }>(
      `
        SELECT DISTINCT variant_type
        FROM ${this.schemaName}."variants"
        WHERE case_id = $1
        ORDER BY variant_type
      `,
      [caseId]
    )
    return result.rows.map((row) => row.variant_type)
  }

  private async loadStarredVariantIds(
    caseId: number,
    db: Queryable = this.options.pool
  ): Promise<Set<number>> {
    const res = await db.query<{ variant_id: number | string }>(
      `
        SELECT variant_id
        FROM ${this.schemaName}."case_variant_annotations"
        WHERE case_id = $1 AND COALESCE(starred, 0)::int = 1
      `,
      [caseId]
    )
    return new Set<number>(res.rows.map((row) => Number(row.variant_id)))
  }

  private hydrateCandidates(rows: Variant[], starredVariantIds: Set<number>): ShortlistCandidate[] {
    return rows.map((row) => toShortlistCandidate(row, starredVariantIds.has(row.id)))
  }
}
