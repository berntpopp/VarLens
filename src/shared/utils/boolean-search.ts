/**
 * Boolean search tokenizer and parser.
 *
 * Tokenizes search input into terms and operators (AND/OR/NOT),
 * then parses into a precedence-correct AST: NOT > AND > OR.
 * Supports parentheses for explicit grouping.
 *
 * Operators are case-sensitive uppercase only — "anderson" is a term, not "AND".
 */

// ── Token types ──

export type Token =
  | { type: 'TERM'; value: string }
  | { type: 'AND' }
  | { type: 'OR' }
  | { type: 'NOT' }
  | { type: 'LPAREN' }
  | { type: 'RPAREN' }

// ── AST node types ──

export type AstNode =
  | { type: 'term'; value: string }
  | { type: 'and'; left: AstNode; right: AstNode }
  | { type: 'or'; left: AstNode; right: AstNode }
  | { type: 'not'; operand: AstNode }

// ── Tokenizer ──

const OPERATORS = new Set(['AND', 'OR', 'NOT'])

export function tokenize(input: string): Token[] {
  const trimmed = input.trim()
  if (trimmed === '') return []

  const tokens: Token[] = []
  const parts = trimmed.match(/\(|\)|[^\s()]+/g) ?? []

  for (const part of parts) {
    if (part === '(') {
      tokens.push({ type: 'LPAREN' })
    } else if (part === ')') {
      tokens.push({ type: 'RPAREN' })
    } else if (OPERATORS.has(part)) {
      tokens.push({ type: part as 'AND' | 'OR' | 'NOT' })
    } else {
      tokens.push({ type: 'TERM', value: part })
    }
  }

  return tokens
}

// ── Recursive descent parser ──
// Precedence (lowest to highest): OR < AND < NOT < TERM/PAREN

export function parse(tokens: Token[]): AstNode {
  if (tokens.length === 0) throw new Error('Empty search expression')

  let pos = 0

  function peek(): Token | undefined {
    return tokens[pos]
  }

  function advance(): Token {
    if (pos >= tokens.length) throw new Error('Unexpected end of expression')
    const token = tokens[pos]!
    pos++
    return token
  }

  // OR: lowest precedence
  function parseOr(): AstNode {
    let left = parseAnd()
    while (peek()?.type === 'OR') {
      advance() // consume OR
      const right = parseAnd()
      left = { type: 'or', left, right }
    }
    return left
  }

  // AND: medium precedence
  function parseAnd(): AstNode {
    let left = parseNot()
    while (peek()?.type === 'AND') {
      advance() // consume AND
      const right = parseNot()
      left = { type: 'and', left, right }
    }
    return left
  }

  // NOT: high precedence (unary prefix)
  function parseNot(): AstNode {
    if (peek()?.type === 'NOT') {
      advance() // consume NOT
      const operand = parseNot() // NOT is right-associative
      return { type: 'not', operand }
    }
    return parsePrimary()
  }

  // Primary: term or parenthesized expression
  function parsePrimary(): AstNode {
    const token = peek()
    if (!token) throw new Error('Unexpected end of expression')

    if (token.type === 'LPAREN') {
      advance() // consume (
      const node = parseOr()
      const closing = advance()
      if (closing.type !== 'RPAREN') {
        throw new Error('Expected closing parenthesis')
      }
      return node
    }

    if (token.type === 'TERM') {
      advance()
      return { type: 'term', value: token.value }
    }

    throw new Error(`Unexpected token: ${token.type}`)
  }

  const ast = parseOr()

  if (pos < tokens.length) {
    throw new Error(`Unexpected token at position ${pos}: ${tokens[pos]?.type}`)
  }

  return ast
}

// ── SQL emission ──

/** Render the AST as a SQL boolean expression; `emitTerm` renders one leaf. */
export function emitBooleanSql(ast: AstNode, emitTerm: (term: string) => string): string {
  switch (ast.type) {
    case 'term':
      return emitTerm(ast.value)
    case 'and':
      return `(${emitBooleanSql(ast.left, emitTerm)} AND ${emitBooleanSql(ast.right, emitTerm)})`
    case 'or':
      return `(${emitBooleanSql(ast.left, emitTerm)} OR ${emitBooleanSql(ast.right, emitTerm)})`
    case 'not':
      return `(NOT (${emitBooleanSql(ast.operand, emitTerm)}))`
  }
}

/**
 * SQL for the cohort search box, the same on SQLite and PostgreSQL. Without an
 * uppercase AND / OR / NOT the whole text is one term; so is an expression that
 * does not parse (`onMalformed` is told why).
 */
export function booleanSearchSql(
  query: string,
  emitTerm: (term: string) => string,
  onMalformed?: (error: unknown) => void
): string {
  if (!/\b(AND|OR|NOT)\b/.test(query)) return emitTerm(query)
  let ast: AstNode
  try {
    ast = parse(tokenize(query))
  } catch (error) {
    onMalformed?.(error)
    return emitTerm(query)
  }
  return emitBooleanSql(ast, emitTerm)
}
