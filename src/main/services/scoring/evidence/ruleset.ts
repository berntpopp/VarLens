/**
 * Evidence ruleset compilation and preset validation (spec §3.4). Every
 * problem is collected and thrown together, each naming the mode, group or
 * rule it concerns, so a stored preset fails loudly instead of falling back
 * to legacy scoring.
 */
import {
  compileRule,
  rulesetUsesHpoResnik,
  type RowPredicate
} from '../../../../shared/dsl/evaluate'
import {
  describeProblem,
  evidenceConfigProblems,
  rulesetProblems
} from '../../../../shared/evidence/ruleset-problems'
import type {
  EvidenceGroup,
  EvidenceRuleset,
  ModeProfile
} from '../../../../shared/types/evidence-ruleset'
import type { ShortlistConfig } from '../../../../shared/types/shortlist'

export class EvidenceRulesetError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Invalid evidence ruleset: ${problems.join('; ')}`)
    this.name = 'EvidenceRulesetError'
  }
}

export interface CompiledRule {
  id: string
  label: string
  points: number
  test: RowPredicate
}
export interface CompiledGroup {
  id: string
  label: string
  scope: EvidenceGroup['scope']
  variantType?: EvidenceGroup['variantType']
  rules: CompiledRule[]
}
/** `test` is null for the fallback mode. */
export interface CompiledMode {
  profile: ModeProfile
  test: RowPredicate | null
}
export interface CompiledRuleset {
  source: EvidenceRuleset
  /** In the fixed decision-list order, fallback last. */
  modes: CompiledMode[]
  groups: CompiledGroup[]
  /** Some mode or rule reads `hpo_resnik`: only then is the HPO scorer loaded. */
  usesHpoResnik: boolean
}

function compileText(text: string): RowPredicate {
  const result = compileRule(text)
  // rulesetProblems has compiled every condition already
  if (!result.ok) throw new EvidenceRulesetError(result.errors)
  return result.predicate
}

/** Validate and compile a ruleset; throws {@link EvidenceRulesetError} listing every problem. */
export function compileRuleset(input: EvidenceRuleset): CompiledRuleset {
  const problems = rulesetProblems(input)
  if (problems.length > 0) {
    throw new EvidenceRulesetError(problems.map((p) => describeProblem(p, input)))
  }
  const modes = input.modes.map((profile) => ({
    profile,
    test: profile.when === null ? null : compileText(profile.when)
  }))
  const groups = input.groups.map((g) => ({
    id: g.id,
    label: g.label,
    scope: g.scope,
    variantType: g.variantType,
    rules: g.rules.map((r) => ({
      id: r.id,
      label: r.label,
      points: r.points,
      test: compileText(r.when)
    }))
  }))
  return { source: input, modes, groups, usesHpoResnik: rulesetUsesHpoResnik(input) }
}

/** Problems of an evidence preset's configuration as text ([] when fine); see `evidenceConfigProblems`. */
export function validateEvidenceConfig(config: ShortlistConfig): string[] {
  return evidenceConfigProblems(config).map((p) => describeProblem(p, config.rankConfig.ruleset))
}
