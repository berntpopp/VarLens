import type { AcmgEvidenceState, AcmgEvidenceCode, AcmgCode } from './types'
import { getDefaultStrength } from './types'

/**
 * Serialize evidence state to JSON string for storage
 */
export function serializeEvidence(state: AcmgEvidenceState): string {
  return JSON.stringify(state)
}

/**
 * Migrate an old-format string code to new AcmgEvidenceCode
 */
function migrateStringCode(code: string): AcmgEvidenceCode {
  return {
    code: code as AcmgCode,
    strength: getDefaultStrength(code as AcmgCode),
    auto_suggested: false,
    confirmed: true
  }
}

/**
 * Check if an evidence array is old format (string[]) or new format (AcmgEvidenceCode[])
 */
function isOldFormat(arr: unknown[]): arr is string[] {
  return arr.length > 0 && typeof arr[0] === 'string'
}

/**
 * Deserialize evidence from JSON string.
 * Handles both old string[] format and new AcmgEvidenceCode[] format.
 */
export function deserializeEvidence(json: string | null): AcmgEvidenceState | null {
  if (json === null || json === '') return null

  try {
    const parsed = JSON.parse(json)

    // Migrate old format if needed
    const pathogenic: AcmgEvidenceCode[] = Array.isArray(parsed.pathogenic)
      ? isOldFormat(parsed.pathogenic)
        ? parsed.pathogenic.map(migrateStringCode)
        : parsed.pathogenic
      : []

    const benign: AcmgEvidenceCode[] = Array.isArray(parsed.benign)
      ? isOldFormat(parsed.benign)
        ? parsed.benign.map(migrateStringCode)
        : parsed.benign
      : []

    return {
      pathogenic,
      benign,
      notes: parsed.notes ?? '',
      classification_date: parsed.classification_date ?? Date.now(),
      calculated_classification: parsed.calculated_classification ?? null,
      is_override: parsed.is_override ?? false
    }
  } catch {
    // Return null for corrupt/invalid JSON — caller handles the null case
    return null
  }
}
