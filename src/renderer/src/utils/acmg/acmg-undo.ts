/**
 * Pure helpers for ACMG classification undo (no Vue).
 *
 * An ACMG change is the highest-stakes write in VarLens. Every committed
 * change (quick class pick, row menu, evidence editor "Apply") gets an
 * undo snackbar that restores the exact previous state — classification
 * and, where the change carried evidence, the previous evidence JSON.
 */
import type { AcmgClassification } from '../../../../shared/config/domain.config'

export interface AcmgState {
  classification: AcmgClassification | null
  /** Evidence JSON; `undefined` when the change did not touch evidence. */
  evidenceJson?: string | null
}

export interface AcmgUndoPlan {
  /** Snackbar text describing what was just saved. */
  message: string
  /** The state to restore when the user clicks Undo. */
  restore: AcmgState
}

function sameEvidence(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? '') === (b ?? '')
}

/**
 * Builds the undo plan for a change from `previous` to `next`, or `null`
 * when nothing actually changed (no snackbar, nothing to undo).
 */
export function planAcmgUndo(previous: AcmgState, next: AcmgState): AcmgUndoPlan | null {
  const touchesEvidence = next.evidenceJson !== undefined
  const classChanged = previous.classification !== next.classification
  const evidenceChanged = touchesEvidence && !sameEvidence(previous.evidenceJson, next.evidenceJson)
  if (!classChanged && !evidenceChanged) return null

  let message: string
  if (!classChanged) message = 'ACMG evidence saved'
  else if (next.classification === null) message = 'ACMG classification cleared'
  else message = `Classified as ${next.classification}`

  return {
    message,
    restore: {
      classification: previous.classification,
      ...(touchesEvidence ? { evidenceJson: previous.evidenceJson ?? '' } : {})
    }
  }
}

/** One-line description of an unsaved evidence draft for the confirm bar. */
export function summarizeAcmgDraft(draft: {
  classification: AcmgClassification | null
  netPoints: number
  codes: string[]
}): string {
  const verdict = draft.classification ?? 'No classification'
  const points = `${draft.netPoints} ${Math.abs(draft.netPoints) === 1 ? 'pt' : 'pts'}`
  const codes = draft.codes.length > 0 ? draft.codes.join(', ') : 'no criteria'
  return `${verdict} · ${points} · ${codes}`
}

function parseEvidence(json: string | null | undefined): Record<string, unknown> | null {
  if (json === null || json === undefined || json === '') return null
  try {
    const parsed = JSON.parse(json) as unknown
    return parsed !== null && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

/**
 * Evidence JSON without volatile fields (`classification_date` is stamped
 * on every serialize), so "draft equals saved" compares content only.
 */
export function evidenceFingerprint(json: string | null | undefined): string {
  const parsed = parseEvidence(json)
  if (parsed === null) return ''
  const rest = { ...parsed }
  delete rest.classification_date
  return JSON.stringify(rest)
}

/** True when the stored evidence has confirmed criteria, notes or an override. */
export function hasMeaningfulAcmgEvidence(json: string | null | undefined): boolean {
  const parsed = parseEvidence(json)
  if (parsed === null) return false
  const confirmed = (list: unknown): boolean =>
    Array.isArray(list) &&
    list.some((c) => typeof c === 'string' || (c as { confirmed?: unknown })?.confirmed === true)
  const notes = typeof parsed.notes === 'string' ? parsed.notes.trim() : ''
  return (
    confirmed(parsed.pathogenic) ||
    confirmed(parsed.benign) ||
    notes !== '' ||
    parsed.is_override === true
  )
}
