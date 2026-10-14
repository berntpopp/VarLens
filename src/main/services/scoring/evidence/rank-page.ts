/**
 * Glue between the evidence engine and the shortlist services (spec §3.3):
 * the pass-1 row projection, the pass-2 page scorer and a compile cache.
 * Both backends call these, so a row scores identically on SQLite and
 * PostgreSQL.
 */
import { SHORTLIST_EVIDENCE_CONFIG } from '../../../../shared/config/shortlist-evidence.config'
import type {
  RankConfig,
  ScoredCandidate,
  ShortlistCandidate
} from '../../../../shared/types/shortlist'
import type { EvidenceRuleset } from '../../../../shared/types/evidence-ruleset'
import { mapClinvarBoost, ZERO_COMPONENTS } from '../index'
import type { GeneContext, LightRow } from './case-context'
import { compileRuleset, type CompiledRuleset } from './ruleset'
import { scoreEvidenceRow } from './score'

/** Copy only the pass-1 fields, so pass 1 keeps ~100 bytes per eligible row. */
export function toLightRow(row: LightRow): LightRow {
  return {
    id: row.id,
    chr: row.chr,
    pos: row.pos,
    ref: row.ref,
    alt: row.alt,
    gene_symbol: row.gene_symbol,
    gt_num: row.gt_num,
    ps: row.ps ?? null
  }
}

const MAX_CACHED = SHORTLIST_EVIDENCE_CONFIG.compiledCacheSize
const compiledCache = new Map<string, CompiledRuleset>()

/** Compile a ruleset once per distinct JSON text; throws like `compileRuleset`. */
export function getCompiledRuleset(ruleset: EvidenceRuleset): CompiledRuleset {
  const key = JSON.stringify(ruleset)
  let compiled = compiledCache.get(key)
  if (compiled === undefined) {
    compiled = compileRuleset(ruleset)
    if (compiledCache.size >= MAX_CACHED) compiledCache.clear()
    compiledCache.set(key, compiled)
  }
  return compiled
}

/**
 * Score one Stage-1 page with the whole-case context. Pins follow the legacy
 * rules so `mergeTopScored` orders evidence rows exactly like legacy ones.
 */
export function scoreEvidencePage(
  page: readonly ShortlistCandidate[],
  ctx: GeneContext,
  compiled: CompiledRuleset,
  rankConfig: RankConfig
): ScoredCandidate[] {
  return page.map((row) => {
    const derived = ctx.derived(toLightRow(row))
    const s = scoreEvidenceRow(row as unknown as Record<string, unknown>, derived, compiled)
    return {
      ...row,
      rank_score: s.score,
      rank_components: ZERO_COMPONENTS,
      rank_clinvar_pinned: rankConfig.clinvarPinTop === true && mapClinvarBoost(row.clinvar) >= 0.9,
      rank_starred_pinned: rankConfig.pinStarredTop === true && row.is_starred === true,
      rank_mode: s.mode,
      rank_evidence: s.contributions,
      rank_partners: s.mode === 'ar_comphet' ? derived.partners : [],
      rank_comphet_phase: s.mode === 'ar_comphet' ? (derived.comphet_phase ?? null) : null
    }
  })
}
