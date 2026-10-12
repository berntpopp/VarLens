/**
 * Built-in "Evidence ranking (beta)" shortlist preset (spec §5.5, §11.6):
 * the hand-set varvis ruleset that passed the pre-registered simulation
 * criterion on 2026-10-12, in exactly the configuration that was benchmarked
 * (`evidenceShortlistConfig`); the starred pin only lifts rows the user
 * starred, which the simulation has none of.
 *
 * Seeded by SQLite migration v47 and PostgreSQL migration 0030 — never via
 * the historical BUILT_IN_SHORTLIST_PRESETS array.
 */
import { evidenceShortlistConfig } from '../../shared/evidence/evidence-shortlist-config'
import type { ShortlistConfig } from '../../shared/types/shortlist'
import { VARVIS_EVIDENCE_BETA_V1 } from './evidence-rulesets/artifact'

/** sha256 of the frozen ruleset; a test checks the artifact still matches. */
export const EVIDENCE_BETA_RULESET_SHA256 =
  '3795570f1ce9ff5600ae719bb278a4cbab43b14dbe99b839ced6ec6e7889cb00'

export const EVIDENCE_BETA_PRESET: {
  name: string
  description: string
  sortOrder: number
  config: ShortlistConfig
} = {
  name: 'Evidence ranking (beta)',
  description:
    'Inheritance-aware evidence points for SNVs and indels; simulation-validated on three immunology exomes.',
  sortOrder: 3,
  config: evidenceShortlistConfig(VARVIS_EVIDENCE_BETA_V1, { pinStarredTop: true })
}

/** The `filter_json` both migrations store. */
export function evidenceBetaFilterJson(): string {
  return JSON.stringify({ shortlist: EVIDENCE_BETA_PRESET.config })
}
