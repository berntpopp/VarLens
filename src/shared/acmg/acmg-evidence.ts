/**
 * A stored `acmg_evidence` JSON (written by the renderer's evidence editor),
 * read where no editor runs: the override-reason rule at the IPC/HTTP
 * boundary (#567) and the ACMG export columns (#574).
 */
import { normalizeAcmgClassification } from '../utils/acmg'
import { calculateClassification, getDefaultStrength, type EvidenceCode } from './acmg-calculator'

export interface StoredAcmgEvidence {
  pathogenic: EvidenceCode[]
  benign: EvidenceCode[]
  /** The class was set against the evidence (the editor's Override). */
  isOverride: boolean
  /** Why the class overrides the evidence (#567); null when none was given. */
  overrideReason: string | null
}

/** Codes stored as plain strings (old format) count at their default strength. */
function codesOf(value: unknown): EvidenceCode[] {
  if (!Array.isArray(value)) return []
  return value.map((c: unknown) =>
    typeof c === 'string' ? { code: c, strength: getDefaultStrength(c), confirmed: true } : c
  ) as EvidenceCode[]
}

/** Parse stored evidence; null when there is none or it is not JSON. */
export function parseAcmgEvidence(json: string | null | undefined): StoredAcmgEvidence | null {
  if (json === null || json === undefined || json === '') return null
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(json) as Record<string, unknown>
  } catch {
    return null
  }
  if (parsed === null || typeof parsed !== 'object') return null
  const reason = typeof parsed.override_reason === 'string' ? parsed.override_reason.trim() : ''
  return {
    pathogenic: codesOf(parsed.pathogenic),
    benign: codesOf(parsed.benign),
    isOverride: parsed.is_override === true,
    overrideReason: reason === '' ? null : reason
  }
}

/**
 * #567: a class that overrides its evidence needs a reason. True when an
 * update (as sent, before validation) stores evidence that is flagged an
 * override, or whose own class differs from the class stored with it, and
 * gives no reason.
 */
export function overrideReasonMissing(update: {
  acmg_classification?: unknown
  acmg_evidence?: unknown
}): boolean {
  if (typeof update.acmg_evidence !== 'string') return false
  const evidence = parseAcmgEvidence(update.acmg_evidence)
  if (evidence === null || evidence.overrideReason !== null) return false
  if (evidence.isOverride) return true
  if (!('acmg_classification' in update)) return false
  const derived = calculateClassification(evidence.pathogenic, evidence.benign).classification
  const cls = update.acmg_classification
  const stored = typeof cls === 'string' ? normalizeAcmgClassification(cls) : null
  return derived !== null && stored !== derived
}

/** Net evidence points and the override reason of a stored classification (exports). */
export function acmgEvidenceFields(json: string | null | undefined): {
  points: number | null
  overrideReason: string | null
} {
  const evidence = parseAcmgEvidence(json)
  if (evidence === null) return { points: null, overrideReason: null }
  const { netPoints, classification } = calculateClassification(
    evidence.pathogenic,
    evidence.benign
  )
  return {
    points: classification === null ? null : netPoints,
    overrideReason: evidence.overrideReason
  }
}

/**
 * The rule on the row as it will be stored: the update's class and evidence
 * over the stored ones. Only an update that sets the class or the evidence
 * is judged, so a star or comment on a legacy reasonless override saves.
 * A key present with no value clears that field.
 */
export function mergedOverrideReasonMissing(
  update: Record<string, unknown>,
  stored: { acmg_classification?: unknown; acmg_evidence?: unknown } | null
): boolean {
  const field = (key: 'acmg_classification' | 'acmg_evidence'): unknown =>
    key in update ? (update[key] ?? null) : (stored?.[key] ?? null)
  if (!('acmg_classification' in update) && !('acmg_evidence' in update)) return false
  return overrideReasonMissing({
    acmg_classification: field('acmg_classification'),
    acmg_evidence: field('acmg_evidence')
  })
}

export const OVERRIDE_REASON_REQUIRED =
  'An ACMG class that overrides the evidence needs a reason'
