/**
 * Compile a DSL rule into a row predicate for evidence-shortlist scoring
 * (spec §3.1). Semantics, deliberately explicit rather than "whatever SQL does":
 *
 * - a comparison never fires on a missing or non-finite value (the filter bars
 *   include empty values in numeric ranges; rules do not);
 * - `consequence` / `clinvar` `=` / `!=` match by normalised category through
 *   the same `severityFilterParts` the SQL severity filter uses;
 * - text `=` / `!=` are exact; `~` is an ASCII case-insensitive substring with
 *   `%` and `_` literal (SQLite `NOCASE LIKE` with escaping);
 * - `is:null` is null or blank text (`column-null-check.ts`);
 * - `info.<KEY>` reads the value with `readInfoValue` (`info-field-filter.ts` twin).
 *
 * Values of an unexpected shape (an imported list, an object) never match and
 * never throw.
 */
import { parseDsl } from './parser'
import { findColumn } from './column-registry'
import type { DslNode, DslFilterRule } from './types'
import type { EvidenceRuleset } from '../types/evidence-ruleset'
import {
  impactRank,
  clinvarRank,
  isSeverityKey,
  severityFilterParts,
  type SeverityKey
} from '../config/severity.config'
import { INFO_FIELD_PREFIX } from '../filters/info-field-filter'
import { readInfoValue } from '../filters/info-value'
import { SHORTLIST_EVIDENCE_CONFIG } from '../config/shortlist-evidence.config'

export type EvaluableRow = Readonly<Record<string, unknown>>
export type RowPredicate = (row: EvaluableRow) => boolean
const { limits } = SHORTLIST_EVIDENCE_CONFIG
export const RULE_LIMITS = {
  maxChars: limits.ruleChars,
  maxDepth: limits.ruleDepth,
  maxNodes: limits.ruleNodes
} as const
export type CompileResult =
  | { ok: true; predicate: RowPredicate; /** registry keys the rule reads */ columns: Set<string> }
  | { ok: false; errors: string[] }

const finite = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null
const asText = (v: unknown): string | null => (typeof v === 'string' ? v : null)
const blank = (v: unknown): boolean => v === null || v === undefined || v === ''
/** ASCII-only lower case, as SQLite NOCASE folds. */
const asciiLower = (s: string): string => s.replace(/[A-Z]/g, (c) => c.toLowerCase())
const contains = (value: string, needle: string): boolean =>
  asciiLower(value).includes(asciiLower(needle))

function compareNumbers(op: string, a: number, b: number): boolean {
  switch (op) {
    case '=':
      return a === b
    case '!=':
      return a !== b
    case '<':
      return a < b
    case '<=':
      return a <= b
    case '>':
      return a > b
    case '>=':
      return a >= b
    default:
      return false
  }
}

function numericOrNull(value: string): number | null {
  if (value.trim() === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function infoPredicate(rule: DslFilterRule): RowPredicate {
  const key = rule.column.slice(INFO_FIELD_PREFIX.length)
  const want = String(rule.value ?? '')
  const wantNum = numericOrNull(want)
  return (row) => {
    const v = readInfoValue(asText(row.info_json), key)
    switch (rule.operator) {
      case 'is:null':
        return !v.present
      case 'is:notnull':
        return v.present
      case '~':
        return v.text !== null && contains(v.text, want)
      case '=':
      case '!=': {
        if (!v.present) return false
        const eq = v.text === want || (v.num !== null && wantNum !== null && v.num === wantNum)
        return rule.operator === '=' ? eq : !eq
      }
      default:
        return v.num !== null && wantNum !== null && compareNumbers(rule.operator, v.num, wantNum)
    }
  }
}

/** `=` / `!=` on a severity column: the SQL severity filter's rank-or-text match. */
function severityPredicate(key: SeverityKey, op: string, want: string): RowPredicate {
  const { ranks } = severityFilterParts(key, [want])
  const rankOf = key === 'clinvar' ? clinvarRank : impactRank
  return (row) => {
    const v = asText(row[key])
    if (v === null) return false
    const match = v === want || ranks.includes(rankOf(v))
    return op === '!=' ? !match : match
  }
}

function textPredicate(key: string, op: string, want: string): RowPredicate {
  return (row) => {
    const v = asText(row[key])
    if (v === null) return false
    if (op === '=') return v === want
    if (op === '!=') return v !== want
    return op === '~' && contains(v, want)
  }
}

function rulePredicate(rule: DslFilterRule): RowPredicate {
  if (rule.column.startsWith(INFO_FIELD_PREFIX)) return infoPredicate(rule)
  const def = findColumn(rule.column)
  const key = def?.key ?? rule.column
  const op = rule.operator
  if (op === 'is:null') return (row) => blank(row[key])
  if (op === 'is:notnull') return (row) => !blank(row[key])
  if (def?.type === 'numeric') {
    const want = Number(rule.value)
    return (row) => {
      const v = finite(row[key])
      return v !== null && compareNumbers(op, v, want)
    }
  }
  const want = String(rule.value ?? '')
  if (isSeverityKey(key) && (op === '=' || op === '!=')) return severityPredicate(key, op, want)
  return textPredicate(key, op, want)
}

function build(node: DslNode): RowPredicate {
  if (node.type === 'rule') return rulePredicate(node)
  if (node.type === 'preset') return () => false // rejected before build
  const parts = node.children.map(build)
  return node.combinator === 'AND'
    ? (row) => parts.every((p) => p(row))
    : (row) => parts.some((p) => p(row))
}

interface AstShape {
  nodes: number
  depth: number
  problems: string[]
  columns: Set<string>
}

/** Size, depth and the references a rule may not hold (presets, non-row fields). */
function inspect(node: DslNode, depth: number, acc: AstShape): void {
  acc.nodes += 1
  acc.depth = Math.max(acc.depth, depth)
  if (node.type === 'preset') acc.problems.push('@preset references are not allowed in rules')
  if (node.type === 'rule' && !node.column.startsWith(INFO_FIELD_PREFIX)) {
    // The parser also admits cohort and SV/CNV/STR extension keys; rules score SNV/indel rows.
    const def = findColumn(node.column)
    if (def === undefined)
      acc.problems.push(`'${node.column}' is not a field of a case variant row`)
    else acc.columns.add(def.key)
  }
  if (node.type === 'group') for (const c of node.children) inspect(c, depth + 1, acc)
}

export function compileRule(input: string): CompileResult {
  if (input.length > RULE_LIMITS.maxChars) {
    return { ok: false, errors: [`Rule is longer than ${RULE_LIMITS.maxChars} characters`] }
  }
  const parsed = parseDsl(input, 'shortlist')
  if (parsed.errors.length > 0) return { ok: false, errors: parsed.errors.map((e) => e.message) }
  if (!parsed.isDsl || parsed.ast === null) {
    return { ok: false, errors: ['Rule must be a filter expression (column:operator:value)'] }
  }
  const shape: AstShape = { nodes: 0, depth: 0, problems: [], columns: new Set() }
  inspect(parsed.ast, 1, shape)
  if (shape.nodes > RULE_LIMITS.maxNodes || shape.depth > RULE_LIMITS.maxDepth) {
    shape.problems.push(
      `Rule exceeds ${RULE_LIMITS.maxNodes} terms or nesting depth ${RULE_LIMITS.maxDepth}`
    )
  }
  if (shape.problems.length > 0) return { ok: false, errors: [...new Set(shape.problems)] }
  return { ok: true, predicate: build(parsed.ast), columns: shape.columns }
}

/** Some mode or rule of the ruleset reads `hpo_resnik`: only then is HPO scoring (or a refetch on a term edit) needed. */
export function rulesetUsesHpoResnik(ruleset: EvidenceRuleset | null | undefined): boolean {
  if (ruleset == null) return false
  return [
    ...ruleset.modes.map((m) => m.when),
    ...ruleset.groups.flatMap((g) => g.rules.map((r) => r.when))
  ].some((text) => {
    if (text === null) return false
    const result = compileRule(text)
    return result.ok && result.columns.has('hpo_resnik')
  })
}
