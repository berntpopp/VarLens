import type { Pool } from 'pg'

import { DatabaseError, NotFoundError } from '../../database/errors'
import {
  normalizeTieBreakerKey,
  throwShortlistQueryErrors,
  type GetShortlistParams
} from '../../database/ShortlistService'
import { toShortlistCandidate, toShortlistVariantFilter } from '../../database/shortlist-query'
import { ShortlistConfigSchema } from '../../../shared/types/ipc-schemas'
import type { FilterPreset } from '../../../shared/types/filter-presets'
import type { Variant } from '../../../shared/types/database'
import type { FilterState } from '../../../shared/types/filters'
import type {
  ScoredCandidate,
  ShortlistCandidate,
  ShortlistConfig,
  ShortlistResult,
  ShortlistRow,
  VariantTypeKey
} from '../../../shared/types/shortlist'
import { compareScoredRows, scoreRow } from '../../services/scoring'
import type { PostgresFilterPresetsRepository } from './PostgresFilterPresetsRepository'
import type { PostgresVariantReadRepository } from './PostgresVariantReadRepository'
import { quoteIdentifier } from './identifiers'

interface PostgresShortlistServiceOptions {
  pool: Pick<Pool, 'query'>
  schema: string
  filterPresets: Pick<PostgresFilterPresetsRepository, 'getPreset'>
  variants: Pick<PostgresVariantReadRepository, 'queryVariants'>
}

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

    const scope = config.variantTypeScope ?? (await this.detectPresentTypes(params.caseId))
    const rowsById = new Map<number, Variant>()
    const queryErrors: Array<{ type: VariantTypeKey; error: Error }> = []
    const perTypeLimit = Math.max(1, config.topN * 4)

    for (const type of scope) {
      try {
        const mergedFilters: Partial<FilterState> = {
          ...config.baseFilters,
          ...(config.perTypeOverrides?.[type] ?? {})
        }
        const result = await this.options.variants.queryVariants(
          toShortlistVariantFilter(params.caseId, type, mergedFilters),
          perTypeLimit,
          0,
          [{ key: 'id', order: 'asc' }],
          true,
          false
        )
        for (const row of result.data) {
          rowsById.set(row.id, row)
        }
      } catch (error) {
        queryErrors.push({ type, error: toError(error) })
      }
    }

    if (queryErrors.length > 0) throwShortlistQueryErrors(queryErrors, 'postgres shortlist')

    const candidates = await this.hydrateCandidates(params.caseId, [...rowsById.values()])
    const scored: ScoredCandidate[] = candidates.map((row) => ({
      ...row,
      ...scoreRow(row, config.rankConfig)
    }))

    scored.sort((a, b) => compareScoredRows(a, b, config.tieBreakers))
    const topN = scored.slice(0, config.topN)
    const rows: ShortlistRow[] = topN.map((row, index) => ({ ...row, rank: index + 1 }))

    const elapsedMs = Date.now() - started
    return {
      rows,
      totalCandidates: candidates.length,
      presetUsed,
      elapsedMs
    }
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

  private async hydrateCandidates(caseId: number, rows: Variant[]): Promise<ShortlistCandidate[]> {
    if (rows.length === 0) return []

    const ids = rows.map((row) => row.id)
    const result = await this.options.pool.query<{ variant_id: number; starred: number }>(
      `
        SELECT variant_id, COALESCE(starred, 0)::int AS starred
        FROM ${this.schemaName}."case_variant_annotations"
        WHERE case_id = $1 AND variant_id = ANY($2::bigint[])
      `,
      [caseId, ids]
    )
    const starredById = new Map(
      result.rows.map((row) => [Number(row.variant_id), Number(row.starred) === 1])
    )

    return rows.map((row) => toShortlistCandidate(row, starredById.get(row.id) === true))
  }
}
