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
import { findColumn } from './column-registry'

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

  constructor(tokens: Token[]) {
    this.tokens = tokens
  }

  parse(): { ast: DslNode | null; errors: DslParseError[] } {
    if (this.tokens.length === 0) {
      return { ast: null, errors: [] }
    }
    const ast = this.parseExpression()
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
    if (!token) return null

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

    // For is:null/is:notnull, the tokenizer may have already collapsed it
    const next = this.peek()
    if (next?.type === 'operator' && (next.value === 'is:null' || next.value === 'is:notnull')) {
      this.advance()
      // Resolve column alias to canonical key (same as the normal path below)
      const colDef = findColumn(colToken.value)
      const canonicalKey = colDef?.key ?? colToken.value
      return {
        type: 'rule',
        column: canonicalKey,
        operator: next.value as DslOperator,
        value: null
      }
    }

    this.expect('colon')

    const opToken = this.peek()
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

    // is:null and is:notnull don't have a value
    if (operator === 'is:null' || operator === 'is:notnull') {
      return { type: 'rule', column: colToken.value, operator, value: null }
    }

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

    // Resolve column alias to canonical key and get type info
    const colDef = findColumn(colToken.value)
    const canonicalKey = colDef?.key ?? colToken.value

    // Coerce numeric values only for numeric columns
    // This prevents chr:=:01 becoming chr:=:1 or chr:=:X failing
    let value: string | number = valToken.value
    if (colDef?.type === 'numeric') {
      const numVal = Number(valToken.value)
      if (Number.isFinite(numVal)) {
        value = numVal
      }
    }

    return { type: 'rule', column: canonicalKey, operator, value }
  }
}

/**
 * Parse a DSL input string into a filter AST.
 *
 * If the input doesn't look like DSL (no colons in filter pattern),
 * returns it as an FTS query instead.
 */
export function parseDsl(input: string): DslParseResult {
  const trimmed = input.trim()

  if (trimmed === '') {
    return { ast: null, isDsl: false, ftsQuery: '', errors: [] }
  }

  if (!isDslInput(trimmed)) {
    return { ast: null, isDsl: false, ftsQuery: trimmed, errors: [] }
  }

  const tokens = tokenize(trimmed)
  const parser = new Parser(tokens)
  const { ast, errors } = parser.parse()

  return { ast, isDsl: true, ftsQuery: '', errors }
}
