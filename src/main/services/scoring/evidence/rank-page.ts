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
import { explainLocus, isLocusRow } from './locus-fields'
import { compileRuleset, type CompiledRuleset } from './ruleset'
import { scoreEvidenceRow } from './score'

/**
 * Copy only the pass-1 fields, so pass 1 keeps ~100 bytes per eligible SNV;
 * CNV and STR rows also keep what their locus score reads.
 */
export function toLightRow(row: LightRow): LightRow {
  const light: LightRow = {
    id: row.id,
    chr: row.chr,
    pos: row.pos,
    ref: row.ref,
    alt: row.alt,
    gene_symbol: row.gene_symbol,
    gt_num: row.gt_num,
    ps: row.ps ?? null
  }
  if (!isLocusRow(row)) return light
  return {
    ...light,
    variant_type: row.variant_type,
    end_pos: row.end_pos ?? null,
    sv_type: row.sv_type ?? null,
    cnv_copy_number: row.cnv_copy_number ?? null,
    str_alt_copies: row.str_alt_copies ?? null,
    str_status: row.str_status ?? null,
    str_repeat_id: row.str_repeat_id ?? null,
    str_variant_catalog_id: row.str_variant_catalog_id ?? null,
    str_repeat_unit: row.str_repeat_unit ?? null,
    info_json: row.info_json ?? null
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

/**
 * The phenotype explanation (`rank_hpo`) for the rows actually returned, so
 * explanations are built only for the kept top N, never for every candidate.
 * CNV/STR rows explain their locus score, with the locus note.
 */
export function withHpoExplanations(rows: ScoredCandidate[], ctx: GeneContext): ScoredCandidate[] {
  const { info } = ctx
  const hpo = info.hpo
  if (hpo === undefined) return rows
  return rows.map((row) => {
    const locus = ctx.locus(toLightRow(row))
    return {
      ...row,
      rank_hpo:
        locus !== null
          ? explainLocus(locus, info)
          : row.gene_symbol === null || row.gene_symbol === ''
            ? null
            : hpo.explain(row.gene_symbol)
    }
  })
}
