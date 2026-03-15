/**
 * DSL tokenizer for the VarLens filter expression language.
 *
 * Splits input like "gnomad_af:<:0.01 AND cadd:>=:20" into typed tokens.
 * Handles compound operators (>=, <=, !=, !~), is:null/is:notnull,
 * quoted values, @preset references, and parentheses.
 */

import type { Token } from './types'

/** Two-char operators that must be checked before single-char */
const COMPOUND_OPS = ['>=', '<=', '!=', '!~']

/** Single-char operators */
const SINGLE_OPS = ['=', '<', '>', '~', '^', '$']

/**
 * Tokenize a DSL input string into an array of tokens.
 * Whitespace tokens are omitted from the result.
 */
export function tokenize(input: string): Token[] {
  const tokens: Token[] = []
  let i = 0

  while (i < input.length) {
    // Skip whitespace
    if (/\s/.test(input[i])) {
      i++
      continue
    }

    // Parentheses
    if (input[i] === '(') {
      tokens.push({ type: 'lparen', value: '(', position: i })
      i++
      continue
    }
    if (input[i] === ')') {
      tokens.push({ type: 'rparen', value: ')', position: i })
      i++
      continue
    }

    // Preset reference: @name
    if (input[i] === '@') {
      const start = i
      i++ // skip @
      let name = ''
      while (i < input.length && /[\w-]/.test(input[i])) {
        name += input[i]
        i++
      }
      tokens.push({ type: 'preset', value: name, position: start })
      continue
    }

    // Colon — context-dependent
    if (input[i] === ':') {
      // Check for is:null or is:notnull
      const lastToken = tokens[tokens.length - 1]
      if (lastToken?.value.toLowerCase() === 'is') {
        // Peek ahead for null or notnull
        const remaining = input.slice(i + 1)
        const nullMatch = remaining.match(/^(notnull|null)\b/i)
        if (nullMatch) {
          // Replace the previous 'is' token + colon + value with a single operator
          tokens.pop() // remove the 'is' token
          // Also remove the preceding colon if present
          if (tokens[tokens.length - 1]?.type === 'colon') {
            tokens.pop()
          }
          const opValue = `is:${nullMatch[1].toLowerCase()}` as 'is:null' | 'is:notnull'
          tokens.push({ type: 'operator', value: opValue, position: lastToken.position })
          i += 1 + nullMatch[1].length
          continue
        }
      }
      tokens.push({ type: 'colon', value: ':', position: i })
      i++
      continue
    }

    // Quoted string value
    if (input[i] === '"' || input[i] === "'") {
      const quote = input[i]
      const start = i
      i++ // skip opening quote
      let value = ''
      while (i < input.length && input[i] !== quote) {
        if (input[i] === '\\' && i + 1 < input.length) {
          value += input[i + 1]
          i += 2
        } else {
          value += input[i]
          i++
        }
      }
      if (i < input.length) i++ // skip closing quote
      tokens.push({ type: 'value', value, position: start })
      continue
    }

    // Check for compound operators (>=, <=, !=, !~)
    if (i + 1 < input.length) {
      const twoChar = input.slice(i, i + 2)
      if (COMPOUND_OPS.includes(twoChar)) {
        tokens.push({ type: 'operator', value: twoChar, position: i })
        i += 2
        continue
      }
    }

    // Single-char operators
    if (SINGLE_OPS.includes(input[i])) {
      tokens.push({ type: 'operator', value: input[i], position: i })
      i++
      continue
    }

    // Word: column name, value, combinator, or 'is' prefix
    const start = i
    let word = ''
    while (i < input.length && /[^\s:()'"=<>!~^$@]/.test(input[i])) {
      word += input[i]
      i++
    }

    if (word === '') {
      // Unknown character, skip
      i++
      continue
    }

    // Classify the word
    const upper = word.toUpperCase()
    if (upper === 'AND' || upper === 'OR') {
      tokens.push({ type: 'combinator', value: upper, position: start })
    } else {
      // Context-dependent: column name, value, or 'is' prefix
      // If preceded by a colon, it's a value; otherwise it's a column
      const prev = tokens[tokens.length - 1]
      if (prev?.type === 'colon') {
        tokens.push({ type: 'value', value: word, position: start })
      } else if (prev?.type === 'operator') {
        // After operator without colon (shouldn't happen in well-formed input)
        tokens.push({ type: 'value', value: word, position: start })
      } else {
        tokens.push({ type: 'column', value: word, position: start })
      }
    }
  }

  return tokens
}

/**
 * Detect whether an input string contains DSL syntax.
 * DSL mode activates when colons are detected in a column:op:value pattern.
 * Plain text without colons is treated as FTS search.
 */
export function isDslInput(input: string): boolean {
  return (
    /\w+:[<>=!~^$]/.test(input) ||
    /\w+:is:(null|notnull)/i.test(input) ||
    /\w+:[^:\s]+:[^:\s]/.test(input) ||
    input.startsWith('@')
  )
}
