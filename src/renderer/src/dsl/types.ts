/**
 * AST types for the VarLens filter DSL.
 *
 * Grammar:
 *   expression  = term (('AND' | 'OR') term)*
 *   term        = '(' expression ')' | filter_rule | preset_ref
 *   filter_rule = column ':' operator ':' value
 *   preset_ref  = '@' identifier
 *   column      = identifier
 *   operator    = '=' | '!=' | '<' | '>' | '<=' | '>=' | '~' | '!~' | '^' | '$' | 'is:null' | 'is:notnull'
 *   value       = quoted_string | number | identifier
 */

/** Operators supported by the DSL */
export type DslOperator =
  | '='
  | '!='
  | '<'
  | '>'
  | '<='
  | '>='
  | '~'
  | '!~'
  | '^'
  | '$'
  | 'is:null'
  | 'is:notnull'

/** Combinators between filter rules */
export type DslCombinator = 'AND' | 'OR'

/** A single filter rule: column:operator:value */
export interface DslFilterRule {
  type: 'rule'
  column: string
  operator: DslOperator
  value: string | number | null
}

/** A reference to a saved preset: @preset_name */
export interface DslPresetRef {
  type: 'preset'
  name: string
}

/** A group of expressions combined with AND/OR */
export interface DslGroup {
  type: 'group'
  combinator: DslCombinator
  children: DslNode[]
}

/** Any node in the filter AST */
export type DslNode = DslFilterRule | DslPresetRef | DslGroup

/** Top-level parse result */
export interface DslParseResult {
  /** Parsed AST (null if input is plain text / FTS) */
  ast: DslNode | null
  /** Whether input was detected as DSL (contains colons) */
  isDsl: boolean
  /** If not DSL, the raw FTS search text */
  ftsQuery: string
  /** Parse errors (empty if successful) */
  errors: DslParseError[]
}

/** A parse error with position info */
export interface DslParseError {
  message: string
  position: number
  length: number
}

/** Token types produced by the tokenizer */
export type TokenType =
  | 'column'
  | 'operator'
  | 'value'
  | 'combinator'
  | 'lparen'
  | 'rparen'
  | 'colon'
  | 'preset'
  | 'whitespace'
  | 'unknown'

/** A single token from the tokenizer */
export interface Token {
  type: TokenType
  value: string
  position: number
}
