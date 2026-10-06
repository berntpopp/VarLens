/**
 * Accessible names for the row annotation actions (star / ACMG / comment).
 *
 * The same string is the button's aria-label and its (delegated) tooltip, so
 * sighted and screen-reader users get identical state information.
 *
 * "Display" values are already swapped for the annotation scope: in `all`
 * scope the global annotation is primary and the per-case one is the ring
 * indicator (see AnnotationsCell).
 */
import type { AnnotationScope } from '../../../../shared/types/annotations'

export interface AnnotationDisplayState {
  scope: AnnotationScope
  showGlobalIndicators: boolean
  starred: boolean
  secondaryStarred: boolean
  acmg: string | null
  secondaryAcmg: string | null
  hasComment: boolean
  secondaryHasComment: boolean
}

export function starLabel(s: AnnotationDisplayState): string {
  if (!s.showGlobalIndicators) return s.starred ? 'Starred — click to unstar' : 'Star variant'
  const all = s.scope === 'all'
  if (s.secondaryStarred && s.starred) return 'Starred (case + global) — click to unstar'
  if (s.secondaryStarred) {
    return all ? 'Case star — click to toggle global star' : 'Global star — click to add case star'
  }
  if (s.starred)
    return all ? 'Starred globally — click to unstar' : 'Starred for this case — click to unstar'
  return 'Star variant'
}

function present(value: string | null): value is string {
  return value !== null && value !== ''
}

export function acmgLabel(s: AnnotationDisplayState): string {
  if (!s.showGlobalIndicators) {
    return present(s.acmg) ? `ACMG: ${s.acmg} — change classification` : 'Set ACMG classification'
  }
  const all = s.scope === 'all'
  const primary = all ? 'Global' : 'Case'
  const secondary = all ? 'Case' : 'Global'
  if (present(s.secondaryAcmg) && present(s.acmg)) {
    return `ACMG ${primary}: ${s.acmg}; ${secondary}: ${s.secondaryAcmg}`
  }
  if (present(s.secondaryAcmg)) return `ACMG ${secondary}: ${s.secondaryAcmg} — set classification`
  if (present(s.acmg)) return all ? `ACMG classified globally: ${s.acmg}` : `ACMG: ${s.acmg}`
  return 'Set ACMG classification'
}

export function commentLabel(s: AnnotationDisplayState): string {
  if (!s.showGlobalIndicators) return s.hasComment ? 'Edit comment' : 'Add comment'
  const all = s.scope === 'all'
  if (s.secondaryHasComment && s.hasComment) {
    return all ? 'Has case + global comments' : 'Has global + case comments'
  }
  if (s.secondaryHasComment)
    return all ? 'Has case comment — add comment' : 'Has global comment — add comment'
  if (s.hasComment) return all ? 'Has global comment — edit' : 'Has case comment — edit'
  return 'Add comment'
}
