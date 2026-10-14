/**
 * Evidence-rule shortlist ranking (spec §3.3): pass 1 builds the whole-case
 * gene context over every eligible SNV/indel row, pass 2 scores each page with
 * it and merges into the top N with the legacy pins and tie-breakers.
 *
 * The configuration helpers are shared with the PostgreSQL service so both
 * backends reject the same presets with the same message.
 */
import { DatabaseError } from './errors'
import {
  forEachCandidatePage,
  SHORTLIST_PAGE_SIZE,
  type ShortlistQuerySource
} from './shortlist-query'
import { mergeTopScored } from '../services/scoring'
import {
  GeneContextBuilder,
  validateEvidenceConfig,
  type CaseInfo,
  type CompiledRuleset
} from '../services/scoring/evidence'
import {
  getCompiledRuleset,
  scoreEvidencePage,
  toLightRow
} from '../services/scoring/evidence/rank-page'
import type { VariantFilter } from '../../shared/types/database'
import type { ScoredCandidate, ShortlistConfig, VariantTypeKey } from '../../shared/types/shortlist'
import { DEFAULT_PANEL_GENOME_BUILD } from '../../shared/filters/panel-intervals'

/**
 * Validate an evidence configuration and compile its ruleset. A broken stored
 * preset fails loudly with its name — never a silent fall back to legacy
 * scoring.
 */
export function compileEvidenceConfig(
  config: ShortlistConfig,
  presetName: string | null
): CompiledRuleset {
  const problems = validateEvidenceConfig(config)
  if (problems.length > 0 || config.rankConfig.ruleset === undefined) {
    const label =
      presetName !== null ? `Shortlist preset "${presetName}"` : 'Shortlist configuration'
    throw new DatabaseError(`${label}: ${problems.join('; ')}`)
  }
  return getCompiledRuleset(config.rankConfig.ruleset)
}

/** Case build and sex as the context builder wants them (`unknown`/`other` → null). */
export function toCaseInfo(
  build: string | null | undefined,
  sex: string | null | undefined
): CaseInfo {
  const normalized = sex?.toLowerCase() ?? null
  return {
    build: build ?? DEFAULT_PANEL_GENOME_BUILD,
    sex: normalized === 'male' || normalized === 'female' ? normalized : null
  }
}

export interface EvidencePassInput {
  source: ShortlistQuerySource
  /** One resolved Stage-1 filter per in-scope type (snv, indel). */
  filters: ReadonlyArray<{ type: VariantTypeKey; filter: VariantFilter }>
  info: CaseInfo
  compiled: CompiledRuleset
  config: ShortlistConfig
  limit: number
}

/**
 * Both passes on the SQLite connection inside a single DEFERRED read snapshot
 * so concurrent import-worker connections cannot mutate variants between passes.
 * Per-type failures are returned for `throwShortlistQueryErrors`.
 */
export function rankEvidenceSqlite(input: EvidencePassInput): {
  kept: ScoredCandidate[]
  totalCandidates: number
  queryErrors: Array<{ type: VariantTypeKey; error: Error }>
} {
  const { source, filters, config, limit } = input
  const db = source.db
  const startedTx = !db.inTransaction
  if (startedTx) {
    db.exec('BEGIN DEFERRED')
  }
  try {
    const builder = new GeneContextBuilder(input.info, config.baseFilters.considerPhasing === true)
    let totalCandidates = 0
    const queryErrors = eachType(filters, (filter) =>
      forEachCandidatePage(source, filter, SHORTLIST_PAGE_SIZE, (page) => {
        totalCandidates += page.length
        builder.add(page.map(toLightRow))
      })
    )
    if (queryErrors.length > 0) return { kept: [], totalCandidates, queryErrors }

    const ctx = builder.build()
    let kept: ScoredCandidate[] = []
    const pass2Errors = eachType(filters, (filter) =>
      forEachCandidatePage(source, filter, SHORTLIST_PAGE_SIZE, (page) => {
        const scored = scoreEvidencePage(page, ctx, input.compiled, config.rankConfig)
        kept = mergeTopScored(kept, scored, limit, config.tieBreakers)
      })
    )
    return { kept, totalCandidates, queryErrors: pass2Errors }
  } finally {
    if (startedTx && db.inTransaction) {
      db.exec('COMMIT')
    }
  }
}

function eachType(
  filters: EvidencePassInput['filters'],
  run: (filter: VariantFilter) => void
): Array<{ type: VariantTypeKey; error: Error }> {
  const errors: Array<{ type: VariantTypeKey; error: Error }> = []
  for (const { type, filter } of filters) {
    try {
      run(filter)
    } catch (e) {
      errors.push({ type, error: e instanceof Error ? e : new Error(String(e)) })
    }
  }
  return errors
}
