/**
 * ShortlistService — orchestrator for the unified case Shortlist tab.
 *
 * Implements the two-stage retrieval pipeline described in the unified
 * shortlist spec (§3 architecture, §5 filter merge semantics, §7 error
 * boundaries 1-2):
 *
 *   Stage 1 — candidate generation
 *     For each variant type in scope, merges `baseFilters` with any
 *     `perTypeOverrides[type]` and runs `queryVariantsByType()` under a
 *     `topN * 4` safety cap. Per-type errors are collected and, if any
 *     type failed, the whole shortlist aborts with `ShortlistQueryError`
 *     — never a silent scope reduction (spec §7 boundary 1).
 *
 *   Stage 2 — pure-TypeScript scoring
 *     Each Stage-1 candidate is passed to `scoreRow()` which dispatches
 *     to the per-type scorer and produces the `rank_score` +
 *     `rank_components` + pin flags. Malformed rows are handled inside
 *     `scoreRow` itself (Wave 1.A) — it falls back to `ZERO_COMPONENTS`
 *     and logs via `mainLogger` so a single bad row never poisons the
 *     whole result (spec §7 boundary 2). The scored rows are sorted via
 *     `compareScoredRows()` which enforces partition ordering:
 *     starred-pinned > clinvar-pinned > rank_score DESC > tie-breakers
 *     > id ASC.
 *
 *   Stage 3 — topN slice + 1-based rank assignment
 *
 * The service exposes a single `getShortlist(params)` entry point with a
 * discriminated union param — `presetId` loads a `kind='shortlist'`
 * preset via `FilterPresetRepository`, `adHocConfig` bypasses the preset
 * repo entirely. A wrong-kind preset throws a `DatabaseError` rather
 * than returning an empty result (clinically misleading to silently
 * suppress).
 *
 * Spec: .planning/specs/2026-04-11-unified-shortlist-ranked-view-design.md
 * (§3, §5, §7)
 */

import type { Database as DatabaseType } from 'better-sqlite3-multiple-ciphers'
import { mainLogger } from '../services/MainLogger'
import { DatabaseError, NotFoundError } from './errors'
import type { FilterPresetRepository } from './FilterPresetRepository'
import { queryVariantsByType } from './shortlist-query'
import { scoreRow, compareScoredRows } from '../services/scoring'
import { ShortlistConfigSchema } from '../../shared/types/ipc-schemas'
import type {
  ShortlistConfig,
  ShortlistCandidate,
  ScoredCandidate,
  ShortlistRow,
  ShortlistResult,
  VariantTypeKey
} from '../../shared/types/shortlist'
import type { FilterPreset } from '../../shared/types/filter-presets'
import type { FilterState } from '../../shared/types/filters'

/**
 * Discriminated union for the shortlist request. `presetId` is the
 * preset-driven path — the repo-layer `getPreset` lookup provides both
 * the config and the `presetUsed` envelope field. `adHocConfig` bypasses
 * the preset repository entirely and returns `presetUsed: null`.
 */
export type GetShortlistParams =
  { caseId: number; presetId: number } | { caseId: number; adHocConfig: ShortlistConfig }

/**
 * Thrown when one or more per-type Stage-1 queries fail. Aggregates the
 * per-type errors so callers can surface a clear diagnostic instead of a
 * silently-narrowed result set.
 *
 * Extends `DatabaseError` so `toSerializableError` (src/main/ipc/errorHandler.ts)
 * maps it to `ErrorCode.DB_ERROR` with the stored message instead of the
 * generic `ErrorCode.UNKNOWN` / "An unexpected error occurred" fallback.
 */
export class ShortlistQueryError extends DatabaseError {
  readonly queryErrors: Array<{ type: VariantTypeKey; error: Error }>

  constructor(message: string, queryErrors: Array<{ type: VariantTypeKey; error: Error }>) {
    super(message)
    this.name = 'ShortlistQueryError'
    this.queryErrors = queryErrors
    Object.setPrototypeOf(this, ShortlistQueryError.prototype)
  }
}

/** Narrow an unknown thrown value into a real `Error` instance. */
function toError(value: unknown): Error {
  if (value instanceof Error) return value
  return new Error(typeof value === 'string' ? value : JSON.stringify(value))
}

/**
 * Convert a dotted extension sort key (`sv.vaf`, `cnv.copy_number`,
 * `str.disease`, `str.str_status`) into the flat column alias that
 * `queryVariantsByType` projects onto `ShortlistCandidate` rows
 * (`sv_vaf`, `cnv_copy_number`, `str_disease`, `str_status`).
 *
 * Called on the resolved tieBreakers regardless of whether they came
 * from the `adHocConfig` branch or a stored `presetId` shortlist, so
 * both paths produce the same comparator behavior. Stage-2 scoring
 * compares keys via direct property lookup on the flat row shape — a
 * dotted key would silently no-op without this normalization.
 *
 * Rule: given `<type>.<col>`, if `<col>` already starts with `<type>_`
 * use `<col>` verbatim (e.g. `str.str_status` → `str_status`);
 * otherwise prefix with `<type>_` (e.g. `sv.vaf` → `sv_vaf`). Matches
 * the aliases defined in `buildExtensionColumnProjection()` inside
 * `shortlist-query.ts`.
 *
 * Exported for use by the IPC handler's allowlist-then-normalize path.
 */
export function normalizeTieBreakerKey(key: string): string {
  const match = /^(sv|cnv|str)\.(.+)$/.exec(key)
  if (match === null) return key
  const typeKey = match[1]
  const column = match[2]
  if (column.startsWith(`${typeKey}_`)) return column
  return `${typeKey}_${column}`
}

export class ShortlistService {
  constructor(
    private readonly db: DatabaseType,
    private readonly presetRepo: FilterPresetRepository
  ) {}

  /**
   * Run the full two-stage shortlist pipeline and return a ranked
   * `ShortlistResult`. See class-level JSDoc for pipeline details.
   */
  getShortlist(params: GetShortlistParams): ShortlistResult {
    const started = Date.now()
    const { config: resolvedConfig, presetUsed } = this.resolveConfig(params)

    // Normalize dotted extension tieBreakers (e.g. `sv.vaf` → `sv_vaf`)
    // for BOTH `presetId` and `adHocConfig` branches. Without this step,
    // a preset that stores tieBreakers in the dotted form used by
    // `SortItem` elsewhere in the app would silently no-op because the
    // Stage-2 comparator does direct property lookups on the flat
    // `ShortlistCandidate` row shape. Applying the normalization here —
    // after `resolveConfig` — guarantees identical behavior regardless
    // of where the config came from.
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

    const scope = config.variantTypeScope ?? this.detectPresentTypes(params.caseId)

    // ── Stage 1: candidate generation ────────────────────────────
    const candidates: ShortlistCandidate[] = []
    const queryErrors: Array<{ type: VariantTypeKey; error: Error }> = []
    const perTypeLimit = Math.max(1, config.topN * 4)

    for (const type of scope) {
      try {
        const mergedFilters: Partial<FilterState> = {
          ...config.baseFilters,
          ...(config.perTypeOverrides?.[type] ?? {})
        }
        const rows = queryVariantsByType(this.db, params.caseId, type, mergedFilters, perTypeLimit)
        candidates.push(...rows)
      } catch (e) {
        queryErrors.push({ type, error: toError(e) })
      }
    }

    if (queryErrors.length > 0) {
      const detail = queryErrors.map((e) => `${e.type}: ${e.error.message}`).join('; ')
      mainLogger.warn(`shortlist query errors: ${detail}`, 'shortlist.service')
      throw new ShortlistQueryError(
        `Shortlist query failed for ${queryErrors.map((e) => e.type).join(', ')}`,
        queryErrors
      )
    }

    const totalCandidates = candidates.length

    // ── Stage 2: pure-TypeScript scoring ─────────────────────────
    // `scoreRow` (Wave 1.A) already catches per-row scorer failures and
    // falls back to `ZERO_COMPONENTS`, so a single malformed row will
    // simply sort to the bottom instead of crashing the whole pass.
    const scored: ScoredCandidate[] = candidates.map((row) => ({
      ...row,
      ...scoreRow(row, config.rankConfig)
    }))

    scored.sort((a, b) => compareScoredRows(a, b, config.tieBreakers))
    const topN = scored.slice(0, config.topN)

    // ── Stage 3: 1-based rank assignment ─────────────────────────
    const rows: ShortlistRow[] = topN.map((row, i) => ({ ...row, rank: i + 1 }))

    const elapsedMs = Date.now() - started
    const presetLabel = 'presetId' in params ? `presetId=${params.presetId}` : 'adHoc'
    mainLogger.info(
      `shortlist: case=${params.caseId} ${presetLabel} ` +
        `rowsIn=${totalCandidates} rowsOut=${rows.length} elapsedMs=${elapsedMs}`,
      'shortlist.service'
    )

    return { rows, totalCandidates, presetUsed, elapsedMs }
  }

  /**
   * Resolve the incoming `GetShortlistParams` into a concrete
   * `ShortlistConfig` plus the optional `presetUsed` envelope field.
   *
   * - `adHocConfig` branch → returned verbatim, `presetUsed: null`.
   * - `presetId` branch → `FilterPresetRepository.getPreset(id)` +
   *   validate `preset.kind === 'shortlist'` + pull the nested
   *   `ShortlistConfig` out of `preset.filterJson.shortlist`.
   *
   * A wrong-kind preset throws a `DatabaseError` — we do NOT fall back
   * to an empty shortlist because that would silently suppress a
   * clinical review signal.
   */
  private resolveConfig(params: GetShortlistParams): {
    config: ShortlistConfig
    presetUsed: FilterPreset | null
  } {
    if ('adHocConfig' in params) {
      return { config: params.adHocConfig, presetUsed: null }
    }

    const preset = this.presetRepo.getPreset(params.presetId)
    if (preset == null) {
      throw new NotFoundError('FilterPreset', params.presetId)
    }
    if (preset.kind !== 'shortlist') {
      throw new DatabaseError(
        `Preset "${preset.name}" is not a shortlist preset (kind='${preset.kind}')`
      )
    }
    // `filter_json` for shortlist presets wraps the config under a
    // `shortlist` key so classic-preset parsing stays unchanged
    // (migration v27 convention). Access it via `as` because the typed
    // `filterJson: Partial<FilterState>` shape does not model this
    // nested extension.
    const nested = (preset.filterJson as unknown as { shortlist?: unknown }).shortlist
    if (nested == null) {
      throw new DatabaseError(
        `Shortlist preset "${preset.name}" is missing filter_json.shortlist payload`
      )
    }
    // Validate the stored payload through the same schema that guards
    // the IPC boundary. Presets are loaded from disk, so a hand-edited
    // DB or an older-schema preset could carry a malformed config that
    // would otherwise produce `NaN * 4` limits, undefined weights, or
    // other silent failures inside the Stage-1/2 pipeline. A parse
    // failure surfaces as a DatabaseError with the structured Zod
    // issues in the message so the renderer can show a meaningful
    // retry banner instead of "An unexpected error occurred".
    const parsed = ShortlistConfigSchema.safeParse(nested)
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
        .join('; ')
      throw new DatabaseError(
        `Shortlist preset "${preset.name}" has an invalid filter_json.shortlist payload: ${issues}`
      )
    }
    return { config: parsed.data as ShortlistConfig, presetUsed: preset }
  }

  /**
   * When the caller does not supply a `variantTypeScope`, infer the
   * present types via a DISTINCT query on `variants.variant_type`. This
   * keeps the Stage-1 loop from running four no-op queries on a
   * case that only carries SNVs.
   */
  private detectPresentTypes(caseId: number): VariantTypeKey[] {
    const rows = this.db
      .prepare(`SELECT DISTINCT variant_type FROM variants WHERE case_id = ?`)
      .all(caseId) as Array<{ variant_type: VariantTypeKey }>
    return rows.map((r) => r.variant_type)
  }
}
