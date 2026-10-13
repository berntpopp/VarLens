/**
 * Frozen evidence rulesets shipped as built-in presets (spec §3.5, §11.6).
 * `sha256` is the SHA-256 of the canonical JSON (sorted keys, no whitespace)
 * of the ruleset without its `sha256` field; a shipped file is never edited —
 * recalibration adds a new file, preset name and migration.
 */
import { createHash } from 'node:crypto'
import type { EvidenceRuleset } from '../../../shared/types/evidence-ruleset'
import varvisEvidenceBetaV1 from './varvis-evidence-beta-v1.json'

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export function rulesetSha256(ruleset: EvidenceRuleset): string {
  const unsigned: Partial<EvidenceRuleset> = { ...ruleset }
  delete unsigned.sha256
  return createHash('sha256').update(canonical(unsigned)).digest('hex')
}

/** The hand-set varvis ruleset that passed the 2026-10-12 simulation (spec §5.5, §15). */
export const VARVIS_EVIDENCE_BETA_V1 = varvisEvidenceBetaV1 as EvidenceRuleset
