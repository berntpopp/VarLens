/**
 * Validation of evidence rulesets and evidence shortlist configurations
 * (spec §3.4, §12). Pure and shared: the main process rejects a stored preset
 * with these problems and the settings editor shows them at the field, so both
 * sides always agree on what is valid.
 *
 * Every problem carries the path of the value it concerns (Zod-style), so the
 * editor can place it; `describeProblem` renders it for log and error text.
 */
import { SHORTLIST_EVIDENCE_CONFIG } from '../config/shortlist-evidence.config'
import { compileRule } from '../dsl/evaluate'
import { parseDsl } from '../dsl/parser'
import { EvidenceRulesetSchema } from '../types/evidence-ruleset-schemas'
import {
  EVIDENCE_MODE_ORDER,
  type EvidenceRule,
  type EvidenceRuleset,
  type ModeProfile
} from '../types/evidence-ruleset'
import type { ShortlistConfig, VariantTypeKey } from '../types/shortlist'

export type ProblemPath = readonly (string | number)[]

export interface EvidenceProblem {
  path: ProblemPath
  message: string
  /** 0-based offset of a DSL error inside the condition text, when known. */
  position?: number
}

const { limits, variantTypes, structuralTypes, referenceRuleSuffix } = SHORTLIST_EVIDENCE_CONFIG

/** SV/CNV join the scorable types only while SV/CNV evidence scoring is enabled (#581). */
const evidenceTypes = (): readonly VariantTypeKey[] =>
  structuralTypes.enabled ? [...variantTypes, ...structuralTypes.types] : variantTypes

/** Dotted key of a path (`groups.0.rules.1.when`), used to look problems up. */
export const problemKey = (path: ProblemPath): string => path.join('.')

/** A group's catch-all reference bin (spec §11.1, §14–15): pinned last; its points may be tuned. */
export const isReferenceRule = (rule: Pick<EvidenceRule, 'id'>): boolean =>
  rule.id.endsWith(referenceRuleSuffix)

/**
 * Modes must be unique and listed in the fixed order (`EVIDENCE_MODE_ORDER`)
 * with exactly one `fallback`, last and without `when`. A different order is
 * rejected rather than re-sorted, so the stored JSON reads as it evaluates.
 */
function modeProblems(modes: readonly ModeProfile[]): EvidenceProblem[] {
  const problems: EvidenceProblem[] = []
  const ranks = modes.map((m) => EVIDENCE_MODE_ORDER.indexOf(m.id))
  if (ranks.some((rank, i) => i > 0 && rank <= ranks[i - 1])) {
    problems.push({
      path: ['modes'],
      message: `modes must be unique and ordered ${EVIDENCE_MODE_ORDER.join(', ')}`
    })
  }
  const last = modes[modes.length - 1]
  if (last?.id !== 'fallback' || last.when !== null) {
    problems.push({ path: ['modes'], message: 'the last mode must be fallback with when=null' })
  }
  modes.forEach((m, i) => {
    if (m.id !== 'fallback' && m.when === null) {
      problems.push({ path: ['modes', i, 'when'], message: 'a condition is required' })
    }
  })
  return problems
}

function groupProblems(rs: EvidenceRuleset): EvidenceProblem[] {
  const problems: EvidenceProblem[] = []
  const groupIds = new Set<string>()
  const ruleIds = new Set<string>()
  let count = 0
  rs.groups.forEach((g, gi) => {
    if (groupIds.has(g.id))
      problems.push({ path: ['groups', gi, 'id'], message: `duplicate group id ${g.id}` })
    groupIds.add(g.id)
    if (g.scope !== 'global' && !rs.modes.some((m) => m.id === g.scope)) {
      problems.push({
        path: ['groups', gi, 'scope'],
        message: `scope names mode ${g.scope}, which the ruleset lacks`
      })
    }
    if (g.variantType !== undefined && !structuralTypes.enabled) {
      problems.push({
        path: ['groups', gi, 'variantType'],
        message: 'variant-type scoped groups need SV/CNV evidence scoring, which is disabled'
      })
    } else if (g.variantType !== undefined && !evidenceTypes().includes(g.variantType)) {
      problems.push({
        path: ['groups', gi, 'variantType'],
        message: `evidence rules cannot score ${g.variantType} variants`
      })
    }
    g.rules.forEach((r, ri) => {
      const at = ['groups', gi, 'rules', ri]
      if (ruleIds.has(r.id))
        problems.push({ path: [...at, 'id'], message: `duplicate rule id ${r.id}` })
      ruleIds.add(r.id)
      count += 1
      if (!isReferenceRule(r)) return
      if (ri !== g.rules.length - 1) {
        problems.push({
          path: at,
          message: 'the reference rule must be the last rule of its group'
        })
      }
    })
  })
  if (count > limits.rulesTotal) {
    problems.push({ path: ['groups'], message: `more than ${limits.rulesTotal} rules (${count})` })
  }
  return problems
}

/** Compile one condition; on failure report the compiler's messages and the parser's position. */
function conditionProblem(path: ProblemPath, text: string): EvidenceProblem | null {
  const result = compileRule(text)
  if (result.ok) return null
  const position = parseDsl(text, 'shortlist').errors[0]?.position
  return { path, message: result.errors.join('; '), ...(position !== undefined && { position }) }
}

/** A value shaped enough for the structural checks to walk it safely. */
function isWalkable(rs: unknown): rs is EvidenceRuleset {
  const r = rs as Partial<EvidenceRuleset> | null
  return (
    Array.isArray(r?.modes) &&
    Array.isArray(r?.groups) &&
    r.groups.every((g) => Array.isArray((g as { rules?: unknown } | null)?.rules))
  )
}

/**
 * Every problem of a ruleset: schema issues, structure (mode order, unique
 * ids, reference rules, size) and conditions that do not compile. Problems are
 * collected together, not first-fail, so an editor can show all at once.
 */
export function rulesetProblems(input: unknown): EvidenceProblem[] {
  const parsed = EvidenceRulesetSchema.safeParse(input)
  const problems: EvidenceProblem[] = parsed.success
    ? []
    : parsed.error.issues.map((i) => ({
        path: i.path.filter((p): p is string | number => typeof p !== 'symbol'),
        message: i.message
      }))
  if (!isWalkable(input)) return problems
  problems.push(...modeProblems(input.modes), ...groupProblems(input))
  const reported = new Set(problems.map((p) => problemKey(p.path)))
  const check = (path: ProblemPath, text: unknown): void => {
    if (typeof text !== 'string' || reported.has(problemKey(path))) return
    const problem = conditionProblem(path, text)
    if (problem) problems.push(problem)
  }
  input.modes.forEach((m, i) => {
    if (m.when !== null) check(['modes', i, 'when'], m.when)
  })
  input.groups.forEach((g, gi) =>
    g.rules.forEach((r, ri) => check(['groups', gi, 'rules', ri, 'when'], r.when))
  )
  return problems
}

/**
 * Problems of an evidence preset's configuration ([] when fine): SNV/indel
 * scope (plus SV/CNV when `structuralTypes` is enabled), no inheritance-mode or
 * family filter in any merged per-type
 * Stage-1 filter (modes are scored, not filtered), and a valid ruleset.
 */
export function evidenceConfigProblems(config: ShortlistConfig): EvidenceProblem[] {
  const problems: EvidenceProblem[] = []
  const scope = config.variantTypeScope ?? []
  const allowed = evidenceTypes()
  if (scope.length === 0 || scope.some((t) => !allowed.includes(t))) {
    problems.push({
      path: ['variantTypeScope'],
      message: `evidence presets must set variantTypeScope to ${allowed.map((t) => `'${t}'`).join(' and/or ')}`
    })
  }
  for (const type of scope) {
    const merged = { ...config.baseFilters, ...config.perTypeOverrides?.[type] }
    if ((merged.inheritanceModes?.length ?? 0) > 0) {
      problems.push({
        path: ['baseFilters', 'inheritanceModes'],
        message: `${type}: inheritance modes are scored, not filtered, in evidence presets`
      })
    }
    if (merged.analysisGroupId != null) {
      problems.push({
        path: ['baseFilters', 'analysisGroupId'],
        message: `${type}: evidence presets do not support a family (analysisGroupId)`
      })
    }
  }
  const ruleset = config.rankConfig.ruleset
  if (ruleset === undefined) {
    problems.push({
      path: ['rankConfig', 'ruleset'],
      message: 'evidence presets need rankConfig.ruleset'
    })
  } else {
    for (const p of rulesetProblems(ruleset)) {
      problems.push({ ...p, path: ['rankConfig', 'ruleset', ...p.path] })
    }
  }
  return problems
}

/**
 * One-line text of a problem for logs and error messages, naming the mode,
 * group or rule by id (`rule lof: …`) when the path points into `ruleset`.
 */
export function describeProblem(problem: EvidenceProblem, ruleset?: EvidenceRuleset): string {
  const inConfig = problem.path[0] === 'rankConfig' && problem.path[1] === 'ruleset'
  const [kind, index, sub, subIndex] = problem.path.slice(inConfig ? 2 : 0)
  let owner = problemKey(problem.path) || '<root>'
  if (kind === 'modes' && typeof index === 'number') {
    owner = `mode ${ruleset?.modes[index]?.id ?? index}`
  } else if (kind === 'groups' && typeof index === 'number') {
    const group = ruleset?.groups[index]
    owner =
      sub === 'rules' && typeof subIndex === 'number'
        ? `rule ${group?.rules[subIndex]?.id ?? subIndex}`
        : `group ${group?.id ?? index}`
  }
  return `${owner}: ${problem.message}`
}
