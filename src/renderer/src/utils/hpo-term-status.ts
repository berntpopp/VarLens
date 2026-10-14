/** Display helpers shared by the HPO term selector and the case banner. */
import { mdiMinusCircleOutline, mdiStar } from '@mdi/js'
import type { CaseHpoTerm } from '../../../shared/types/api'
import { HPO_TERM_COPY as COPY } from '../config/hpoTermCopy'

/** A term with its status; the selector's `add:term` and `update:term` carry it (upsert). */
export interface HpoTermChange {
  hpoId: string
  hpoLabel: string
  excluded: boolean
  key: boolean
}

type StatusTerm = Pick<CaseHpoTerm, 'hpo_id' | 'hpo_label' | 'excluded' | 'key'>

export function hpoTermLabel(term: Pick<CaseHpoTerm, 'hpo_id' | 'hpo_label'>): string {
  return term.hpo_label || term.hpo_id
}

/** Icon that carries the state alongside colour: minus for excluded, star for key. */
export function hpoTermIcon(term: StatusTerm): string | undefined {
  if (term.excluded) return mdiMinusCircleOutline
  return term.key ? mdiStar : undefined
}

export function hpoTermAriaLabel(term: StatusTerm): string {
  const state = term.excluded ? 'excluded' : term.key ? COPY.keyState : 'present'
  return `${hpoTermLabel(term)}, ${state}`
}

/** Key terms first, then present, then excluded; stable within each group. */
export function orderHpoTerms<T extends StatusTerm>(terms: readonly T[]): T[] {
  const rank = (t: StatusTerm): number => (t.excluded ? 2 : t.key ? 0 : 1)
  return [...terms].sort((a, b) => rank(a) - rank(b))
}

/** Overflow tooltip lines grouped by state; empty groups are omitted. */
export function groupedHpoTermLines(terms: readonly StatusTerm[]): string[] {
  const groups: Array<[string, StatusTerm[]]> = [
    ['Key', terms.filter((t) => !t.excluded && t.key)],
    [COPY.present, terms.filter((t) => !t.excluded && !t.key)],
    [COPY.excluded, terms.filter((t) => t.excluded)]
  ]
  return groups
    .filter(([, list]) => list.length > 0)
    .map(([name, list]) => `${name}: ${list.map(hpoTermLabel).join(', ')}`)
}
