/**
 * Evidence-rule shortlist ruleset (spec §3.4). Rules are DSL text compiled
 * with `compileRule` in the shortlist scope; points are ranking points, not
 * probabilities.
 */

/** Inheritance-mode profiles, in their fixed decision-list order. */
export const EVIDENCE_MODE_ORDER = ['ar_hom', 'ar_comphet', 'xl', 'ad', 'fallback'] as const
export type ModeId = (typeof EVIDENCE_MODE_ORDER)[number]

export interface EvidenceRule {
  id: string
  label: string
  when: string
  points: number
}

/** A decision list: the first rule whose `when` matches contributes its points. */
export interface EvidenceGroup {
  id: string
  label: string
  /** `global` applies under every mode; a mode id only under that mode. */
  scope: 'global' | ModeId
  rules: EvidenceRule[]
}

/** `fallback` has `when: null` and applies only when no specific mode matches. */
export interface ModeProfile {
  id: ModeId
  label: string
  when: string | null
  points: number
}

export interface EvidenceRuleset {
  version: 1
  id: string
  sha256?: string
  modes: ModeProfile[]
  groups: EvidenceGroup[]
}

/** One term of a row's score; the terms of a row sum to its score. */
export interface EvidenceContribution {
  kind: 'mode' | 'rule'
  id: string
  label: string
  /** The group of a rule contribution; null for the mode term. */
  group: string | null
  points: number
}
