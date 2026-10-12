/**
 * Recursive descent parser for the VarLens filter DSL.
 *
 * Converts a token stream into an AST. Handles:
 * - Single rules: column:operator:value
 * - Compound expressions: rule AND rule, rule OR rule
 * - Grouped expressions: (expr) AND (expr)
 * - Preset references: @name
 * - Graceful error reporting with position info
 */

import type {
  DslNode,
  DslFilterRule,
  DslPresetRef,
  DslParseResult,
  DslParseError,
  DslOperator,
  DslCombinator,
  Token
} from './types'
import { tokenize, isDslInput } from './tokenizer'
import {
  COHORT_ONLY_COLUMNS,
  findColumn,
  INFO_FIELD_OPERATORS,
  isColumnInScope,
  type FilterScope
} from './column-registry'
import { NUMERIC_COLUMN_FILTER_KEYS } from '../filters/column-filter-validation'
import { EXTENSION_FILTERABLE_DOTTED_KEYS } from '../types/variant-extension-registry-data'
import {
  INFO_FIELD_PREFIX,
  infoFieldFilterProblem,
  isValidInfoKey
} from '../filters/info-field-filter'

/** Operators for fields outside the DSL registry (extension and cohort keys). */
const NUMERIC_OPERATORS: DslOperator[] = ['=', '!=', '<', '>', '<=', '>=']
const TEXT_OPERATORS: DslOperator[] = ['=', '!=', '~']

const VALID_OPERATORS = new Set<string>([
  '=',
  '!=',
  '<',
  '>',
  '<=',
  '>=',
  '~',
  '!~',
  '^',
  '$',
  'is:null',
  'is:notnull'
])

class Parser {
  private tokens: Token[]
  private pos: number = 0
  private errors: DslParseError[] = []

  constructor(
    tokens: Token[],
    private readonly scope: FilterScope
  ) {
    this.tokens = tokens
  }

  parse(): { ast: DslNode | null; errors: DslParseError[] } {
    if (this.tokens.length === 0) {
      return { ast: null, errors: [] }
    }
    const stray = this.tokens.find((t) => t.type === 'unknown')
    if (stray) {
      const quote = stray.value.startsWith('"') || stray.value.startsWith("'")
      this.errors.push({
        message: quote ? 'Unclosed quote' : `Unexpected character '${stray.value}'`,
        position: stray.position,
        length: stray.value.length
      })
      return { ast: null, errors: this.errors }
    }
    const ast = this.parseExpression()
    // The whole input must be consumed: a valid prefix must never apply on its own
    const rest = this.peek()
    if (rest && this.errors.length === 0) {
      this.errors.push({
        message: `Unexpected '${rest.value}' after a complete condition`,
        position: rest.position,
        length: rest.value.length || 1
      })
    }
    return { ast, errors: this.errors }
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos]
  }

  private advance(): Token {
    return this.tokens[this.pos++]
  }

  private expect(type: string): Token | undefined {
    const token = this.peek()
    if (!token || token.type !== type) {
      this.errors.push({
        message: `Expected ${type}, got ${token?.type ?? 'end of input'}`,
        position: token?.position ?? this.tokens[this.tokens.length - 1]?.position ?? 0,
        length: token?.value.length ?? 1
      })
      return undefined
    }
    return this.advance()
  }

  /**
   * expression = term (('AND' | 'OR') term)*
   *
   * IMPORTANT: Mixing AND/OR without parentheses is a parse error.
   * Users must use parentheses to clarify: (a AND b) OR c
   * This prevents ambiguity in a clinical tool where filter correctness matters.
   */
  private parseExpression(): DslNode | null {
    const first = this.parseTerm()
    if (!first) return null

    const combToken = this.peek()
    if (!combToken || combToken.type !== 'combinator') {
      return first
    }

    const combinator = combToken.value as DslCombinator
    const children: DslNode[] = [first]

    while (this.peek()?.type === 'combinator') {
      const nextComb = this.peek()!
      if (nextComb.value !== combinator) {
        this.errors.push({
          message: `Cannot mix AND and OR without parentheses. Use: (a ${combinator} b) ${nextComb.value} c`,
          position: nextComb.position,
          length: nextComb.value.length
        })
        break
      }
      this.advance() // consume combinator
      const next = this.parseTerm()
      if (next) children.push(next)
    }

    if (children.length === 1) return children[0]
    return { type: 'group', combinator, children }
  }

  /** term = '(' expression ')' | preset_ref | filter_rule */
  private parseTerm(): DslNode | null {
    const token = this.peek()
    if (!token) {
      // Only reachable after a combinator or '(' — the input ended mid-expression
      const last = this.tokens[this.tokens.length - 1]
      this.errors.push({
        message: `Expected a condition after '${last.value}'`,
        position: last.position,
        length: last.value.length || 1
      })
      return null
    }

    // Parenthesized group
    if (token.type === 'lparen') {
      this.advance() // consume '('
      const inner = this.parseExpression()
      this.expect('rparen')
      return inner
    }

    // Preset reference
    if (token.type === 'preset') {
      this.advance()
      return { type: 'preset', name: token.value } as DslPresetRef
    }

    // Filter rule: column:operator:value
    return this.parseFilterRule()
  }

  /** filter_rule = column ':' operator ':' value */
  private parseFilterRule(): DslFilterRule | null {
    const colToken = this.expect('column')
    if (!colToken) return null

    // For is:null/is:notnull, the tokenizer has already collapsed it
    const next = this.peek()
    if (next?.type === 'operator' && (next.value === 'is:null' || next.value === 'is:notnull')) {
      this.advance()
      return this.buildRule(colToken, next.value, null, next)
    }

    this.expect('colon')

    const afterColon = this.peek()

    // Shorthand: column:value (no explicit operator)
    // Defaults to '~' (LIKE) for text/categorical, '=' for numeric
    // e.g. gene_symbol:PKD1 → gene_symbol:~:PKD1, gnomad_af:0.01 → gnomad_af:=:0.01
    // Only apply when the value is NOT followed by a colon (which would
    // indicate a malformed column:badOp:value expression)
    if (afterColon?.type === 'value') {
      const afterValue = this.tokens[this.pos + 1]
      if (afterValue === undefined || afterValue.type !== 'colon') {
        this.advance()
        const colDef = findColumn(colToken.value)
        const supportsLike = colDef?.operators.includes('~' as DslOperator) ?? false
        const defaultOp: DslOperator = colDef?.type === 'numeric' || !supportsLike ? '=' : '~'
        return this.buildRule(colToken, defaultOp, afterColon.value, afterColon)
      }
    }

    const opToken = afterColon
    if (!opToken || opToken.type !== 'operator') {
      this.errors.push({
        message: `Expected operator after '${colToken.value}:', got ${opToken?.type ?? 'end of input'}`,
        position: opToken?.position ?? colToken.position + colToken.value.length + 1,
        length: opToken?.value.length ?? 1
      })
      return null
    }

    if (!VALID_OPERATORS.has(opToken.value)) {
      this.errors.push({
        message: `Unknown operator '${opToken.value}'`,
        position: opToken.position,
        length: opToken.value.length
      })
      return null
    }
    this.advance()
    const operator = opToken.value as DslOperator

    this.expect('colon')

    const valToken = this.peek()
    if (!valToken || valToken.type !== 'value') {
      this.errors.push({
        message: `Expected value after '${colToken.value}:${operator}:'`,
        position: valToken?.position ?? opToken.position + opToken.value.length + 1,
        length: 1
      })
      return null
    }
    this.advance()
    return this.buildRule(colToken, operator, valToken.value, valToken)
  }

  /**
   * Resolve the field (alias → canonical key) and check operator and raw value
   * against its type before any coercion; records an error and returns null
   * for anything the backend would not apply as written.
   */
  private buildRule(
    colToken: Token,
    operator: DslOperator,
    raw: string | null,
    valueToken: Token
  ): DslFilterRule | null {
    const fail = (message: string, token: Token = colToken): null => {
      this.errors.push({ message, position: token.position, length: token.value.length || 1 })
      return null
    }
    if (colToken.value.toLowerCase().startsWith(INFO_FIELD_PREFIX)) {
      if (this.scope === 'cohort') {
        return fail(
          `'${colToken.value}' is a per-case INFO field and cannot filter the cohort view`
        )
      }
      return buildInfoRule(colToken, operator, raw, valueToken, fail)
    }
    const colDef = findColumn(colToken.value)
    const column = colDef?.key ?? colToken.value
    // Reject before any request: the other view's backend cannot filter on it
    if (colDef && !isColumnInScope(colDef, this.scope)) {
      return fail(`'${colToken.value}' is a per-case field and cannot filter the cohort view`)
    }
    if (this.scope === 'case' && COHORT_ONLY_COLUMNS.some((c) => c.key === column)) {
      return fail(`'${colToken.value}' is a cohort field and cannot filter a single case`)
    }
    const numeric = colDef ? colDef.type === 'numeric' : NUMERIC_COLUMN_FILTER_KEYS.has(column)
    if (!colDef && !numeric && !EXTENSION_FILTERABLE_DOTTED_KEYS.has(column)) {
      return fail(`Unknown field '${colToken.value}'`)
    }

    if (operator === 'is:null' || operator === 'is:notnull') {
      return { type: 'rule', column, operator, value: null }
    }
    const allowed = colDef?.operators ?? (numeric ? NUMERIC_OPERATORS : TEXT_OPERATORS)
    if (!allowed.includes(operator)) {
      return fail(`Operator '${operator}' is not supported for '${colToken.value}'`, valueToken)
    }

    const text = raw ?? ''
    if (numeric) {
      // Validate the raw text: Number('') is 0, and a blank value is not a number
      const num = Number(text)
      if (text.trim() === '' || !Number.isFinite(num)) {
        return fail(`'${text}' is not a number for '${colToken.value}'`, valueToken)
      }
      return { type: 'rule', column, operator, value: num }
    }
    if (operator === '~' && text.trim() === '') {
      return fail(`'${colToken.value}:~' needs a non-empty value`, valueToken)
    }
    // Text values are never coerced: chr:=:01 must stay '01'
    return { type: 'rule', column, operator, value: text }
  }
}

/**
 * `info.<KEY>` (#538): a custom VCF INFO value, case view only. The key keeps
 * its case (VCF IDs are case-sensitive); `=`/`!=`/`~` values stay text — the
 * backend compares numerically only where both sides are numbers.
 */
function buildInfoRule(
  colToken: Token,
  operator: DslOperator,
  raw: string | null,
  valueToken: Token,
  fail: (message: string, token?: Token) => null
): DslFilterRule | null {
  const key = colToken.value.slice(INFO_FIELD_PREFIX.length)
  const column = `${INFO_FIELD_PREFIX}${key}`
  if (!isValidInfoKey(key)) return fail(`'${key}' is not a valid INFO field name`)
  if (operator === 'is:null' || operator === 'is:notnull') {
    return { type: 'rule', column, operator, value: null }
  }
  if (!INFO_FIELD_OPERATORS.includes(operator)) {
    return fail(`Operator '${operator}' is not supported for '${column}'`, valueToken)
  }
  const text = raw ?? ''
  if (operator === '~' && text.trim() === '') {
    return fail(`'${column}:~' needs a non-empty value`, valueToken)
  }
  const problem = infoFieldFilterProblem(column, {
    operator: operator === '~' ? 'like' : (operator as '=' | '!=' | '<' | '>' | '<=' | '>='),
    value: text
  })
  if (problem !== null) return fail(problem, valueToken)
  const range = operator !== '=' && operator !== '!=' && operator !== '~'
  return { type: 'rule', column, operator, value: range ? Number(text) : text }
}

/**
 * Parse a DSL input string into a filter AST.
 *
 * If the input doesn't look like DSL (no colons in filter pattern),
 * returns it as an FTS query instead.
 */
export function parseDsl(input: string, scope: FilterScope = 'case'): DslParseResult {
  const trimmed = input.trim()

  if (trimmed === '') {
    return { ast: null, isDsl: false, ftsQuery: '', errors: [] }
  }

  if (!isDslInput(trimmed)) {
    return { ast: null, isDsl: false, ftsQuery: trimmed, errors: [] }
  }

  const tokens = tokenize(trimmed)
  const parser = new Parser(tokens, scope)
  const { ast, errors } = parser.parse()

  return { ast, isDsl: true, ftsQuery: '', errors }
}
