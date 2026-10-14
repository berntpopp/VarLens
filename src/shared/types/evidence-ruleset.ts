/**
 * Evidence-rule shortlist ruleset (spec §3.4). Rules are DSL text compiled
 * with `compileRule` in the shortlist scope; points are ranking points, not
 * probabilities.
 */

import { EVIDENCE_MODE_ORDER, type EvidenceModeId } from '../config/shortlist-evidence.config'
import type { VariantTypeKey } from './shortlist'

/** Inheritance-mode profiles, in their fixed decision-list order. */
export { EVIDENCE_MODE_ORDER }
export type ModeId = EvidenceModeId

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
  /** Only rows of this variant type (SV/CNV evidence scoring, #581); absent = every type. */
  variantType?: VariantTypeKey
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
