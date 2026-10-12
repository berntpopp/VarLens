/**
 * Evidence ruleset compilation and preset validation (spec §3.4). Every
 * problem is collected and thrown together, each naming the mode, group or
 * rule it concerns, so a stored preset fails loudly instead of falling back
 * to legacy scoring.
 */
import { compileRule, type RowPredicate } from '../../../../shared/dsl/evaluate'
import { EvidenceRulesetSchema } from '../../../../shared/types/evidence-ruleset-schemas'
import {
  EVIDENCE_MODE_ORDER,
  type EvidenceGroup,
  type EvidenceRuleset,
  type ModeProfile
} from '../../../../shared/types/evidence-ruleset'
import type { ShortlistConfig, VariantTypeKey } from '../../../../shared/types/shortlist'

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
}

const MAX_RULES = 200
const EVIDENCE_TYPES: readonly VariantTypeKey[] = ['snv', 'indel']

function compileText(owner: string, text: string, problems: string[]): RowPredicate {
  const result = compileRule(text)
  if (result.ok) return result.predicate
  problems.push(`${owner}: ${result.errors.join(', ')}`)
  return () => false
}

/**
 * Modes must be unique and listed in the fixed order (`EVIDENCE_MODE_ORDER`)
 * with exactly one `fallback`, last and without `when`. A different order is
 * rejected rather than re-sorted, so the stored JSON reads as it evaluates.
 */
function modeProblems(modes: readonly ModeProfile[]): string[] {
  const problems: string[] = []
  const ranks = modes.map((m) => EVIDENCE_MODE_ORDER.indexOf(m.id))
  if (ranks.some((rank, i) => i > 0 && rank <= ranks[i - 1])) {
    problems.push(`modes must be unique and ordered ${EVIDENCE_MODE_ORDER.join(', ')}`)
  }
  const last = modes[modes.length - 1]
  if (last?.id !== 'fallback' || last.when !== null) {
    problems.push('the last mode must be fallback with when=null')
  }
  for (const m of modes) {
    if (m.id !== 'fallback' && m.when === null) problems.push(`mode ${m.id}: when is required`)
  }
  return problems
}

function groupProblems(rs: EvidenceRuleset): string[] {
  const problems: string[] = []
  const groupIds = new Set<string>()
  const ruleIds = new Set<string>()
  let count = 0
  for (const g of rs.groups) {
    if (groupIds.has(g.id)) problems.push(`duplicate group id ${g.id}`)
    groupIds.add(g.id)
    if (g.scope !== 'global' && !rs.modes.some((m) => m.id === g.scope)) {
      problems.push(`group ${g.id}: scope names mode ${g.scope}, which the ruleset lacks`)
    }
    for (const r of g.rules) {
      if (ruleIds.has(r.id)) problems.push(`duplicate rule id ${r.id}`)
      ruleIds.add(r.id)
      count += 1
    }
  }
  if (count > MAX_RULES) problems.push(`more than ${MAX_RULES} rules (${count})`)
  return problems
}

/** Validate and compile a ruleset; throws {@link EvidenceRulesetError} listing every problem. */
export function compileRuleset(input: EvidenceRuleset): CompiledRuleset {
  const parsed = EvidenceRulesetSchema.safeParse(input)
  if (!parsed.success) {
    throw new EvidenceRulesetError(
      parsed.error.issues.map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
    )
  }
  const rs: EvidenceRuleset = parsed.data
  const problems = [...modeProblems(rs.modes), ...groupProblems(rs)]
  const modes = rs.modes.map((profile) => ({
    profile,
    test: profile.when === null ? null : compileText(`mode ${profile.id}`, profile.when, problems)
  }))
  const groups = rs.groups.map((g) => ({
    id: g.id,
    label: g.label,
    scope: g.scope,
    rules: g.rules.map((r) => ({
      id: r.id,
      label: r.label,
      points: r.points,
      test: compileText(`rule ${r.id}`, r.when, problems)
    }))
  }))
  if (problems.length > 0) throw new EvidenceRulesetError(problems)
  return { source: rs, modes, groups }
}

/**
 * Problems of an evidence preset's configuration ([] when fine): SNV/indel
 * scope only, no inheritance-mode or family filter in any merged per-type
 * Stage-1 filter (modes are scored, not filtered), and a valid ruleset.
 */
export function validateEvidenceConfig(config: ShortlistConfig): string[] {
  const problems: string[] = []
  const scope = config.variantTypeScope ?? []
  if (scope.length === 0 || scope.some((t) => !EVIDENCE_TYPES.includes(t))) {
    problems.push("evidence presets must set variantTypeScope to 'snv' and/or 'indel'")
  }
  for (const type of scope) {
    const merged = { ...config.baseFilters, ...config.perTypeOverrides?.[type] }
    if ((merged.inheritanceModes?.length ?? 0) > 0) {
      problems.push(`${type}: inheritance modes are scored, not filtered, in evidence presets`)
    }
    if (merged.analysisGroupId != null) {
      problems.push(`${type}: evidence presets do not support a family (analysisGroupId)`)
    }
  }
  const ruleset = config.rankConfig.ruleset
  if (ruleset === undefined) {
    problems.push('evidence presets need rankConfig.ruleset')
  } else {
    try {
      compileRuleset(ruleset)
    } catch (error) {
      if (!(error instanceof EvidenceRulesetError)) throw error
      problems.push(...error.problems)
    }
  }
  return problems
}
