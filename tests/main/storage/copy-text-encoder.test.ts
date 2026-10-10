import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import {
  encodeText,
  encodeInteger,
  encodeFloat,
  encodeRowsToCopyText,
  EncoderInvalidValueError
} from '../../../src/main/storage/postgres/copy-text-encoder'

/**
 * Reference COPY text-format decoder. Mirrors Postgres' decoding rules.
 * Matches the four mandatory escapes: \\, \n, \r, \t. Treats \N as NULL.
 */
function decodeCopyText(token: string): string | null {
  if (token === '\\N') return null
  let out = ''
  let i = 0
  while (i < token.length) {
    const c = token[i]
    if (c === '\\') {
      const next = token[i + 1]
      if (next === '\\') {
        out += '\\'
        i += 2
        continue
      }
      if (next === 'n') {
        out += '\n'
        i += 2
        continue
      }
      if (next === 'r') {
        out += '\r'
        i += 2
        continue
      }
      if (next === 't') {
        out += '\t'
        i += 2
        continue
      }
      // Any other backslash sequence — Postgres takes the second char literally.
      out += next ?? ''
      i += 2
      continue
    }
    out += c
    i += 1
  }
  return out
}

describe('encodeText', () => {
  it('null → \\N', () => {
    expect(encodeText(null)).toBe('\\N')
  })
  it('undefined → \\N', () => {
    expect(encodeText(undefined)).toBe('\\N')
  })
  it('empty string → "" (empty, NOT null)', () => {
    expect(encodeText('')).toBe('')
  })
  it('plain ASCII → unchanged', () => {
    expect(encodeText('chr1')).toBe('chr1')
  })
  it('escapes backslash before other escapes', () => {
    expect(encodeText('a\\b')).toBe('a\\\\b')
  })
  it('escapes newline', () => {
    expect(encodeText('a\nb')).toBe('a\\nb')
  })
  it('escapes carriage return', () => {
    expect(encodeText('a\rb')).toBe('a\\rb')
  })
  it('escapes tab', () => {
    expect(encodeText('a\tb')).toBe('a\\tb')
  })
  it('the literal string \\N is escaped to \\\\N (still null when decoded? no — different bytes)', () => {
    expect(encodeText('\\N')).toBe('\\\\N')
  })
  it('throws EncoderInvalidValueError on U+0000', () => {
    expect(() => encodeText('a\u0000b')).toThrow(EncoderInvalidValueError)
  })
})

describe('encodeInteger', () => {
  it('null → \\N', () => {
    expect(encodeInteger(null)).toBe('\\N')
  })
  it('undefined → \\N', () => {
    expect(encodeInteger(undefined)).toBe('\\N')
  })
  it('0 → "0"', () => {
    expect(encodeInteger(0)).toBe('0')
  })
  it('positive number → string', () => {
    expect(encodeInteger(42)).toBe('42')
  })
  it('negative number → string', () => {
    expect(encodeInteger(-7)).toBe('-7')
  })
  it('bigint → string', () => {
    expect(encodeInteger(9007199254740992n)).toBe('9007199254740992')
  })
  it('preserves values at and beyond int32 boundary (regression: previously truncated via | 0)', () => {
    expect(encodeInteger(2 ** 31)).toBe('2147483648')
    expect(encodeInteger(-(2 ** 31) - 1)).toBe('-2147483649')
  })
  it('preserves 1e10 (regression: previously truncated via | 0 to "1410065408")', () => {
    expect(encodeInteger(1e10)).toBe('10000000000')
  })
  it('preserves Number.MAX_SAFE_INTEGER', () => {
    expect(encodeInteger(Number.MAX_SAFE_INTEGER)).toBe('9007199254740991')
  })
  it('bigint near 2^63 - 1 (Postgres bigint upper bound)', () => {
    expect(encodeInteger(9223372036854775807n)).toBe('9223372036854775807')
  })
  it('throws EncoderInvalidValueError on non-integer JS number (0.5)', () => {
    expect(() => encodeInteger(0.5)).toThrow(EncoderInvalidValueError)
  })
  it('throws EncoderInvalidValueError on NaN', () => {
    expect(() => encodeInteger(NaN)).toThrow(EncoderInvalidValueError)
  })
  it('throws EncoderInvalidValueError on Infinity', () => {
    expect(() => encodeInteger(Infinity)).toThrow(EncoderInvalidValueError)
  })
  it('throws EncoderInvalidValueError on -Infinity', () => {
    expect(() => encodeInteger(-Infinity)).toThrow(EncoderInvalidValueError)
  })
})

describe('encodeFloat', () => {
  it('null → \\N', () => {
    expect(encodeFloat(null)).toBe('\\N')
  })
  it('0 → "0"', () => {
    expect(encodeFloat(0)).toBe('0')
  })
  it('NaN → "NaN" (Postgres float8 token)', () => {
    expect(encodeFloat(NaN)).toBe('NaN')
  })
  it('Infinity → "Infinity"', () => {
    expect(encodeFloat(Infinity)).toBe('Infinity')
  })
  it('-Infinity → "-Infinity"', () => {
    expect(encodeFloat(-Infinity)).toBe('-Infinity')
  })
})

describe('encodeRowsToCopyText (async generator)', () => {
  it('emits one tab-separated line per row, terminated by \\n', async () => {
    const cols = [
      { name: 'a', encoder: encodeText },
      { name: 'b', encoder: encodeInteger }
    ]
    const rows = [
      { a: 'hello', b: 1 },
      { a: 'world', b: null }
    ]
    let out = ''
    for await (const chunk of encodeRowsToCopyText(cols, rows)) {
      out += chunk.toString('utf8')
    }
    expect(out).toBe('hello\t1\nworld\t\\N\n')
  })
})

describe('property: encodeText round-trip', () => {
  it('decode(encode(v)) === v for every non-NUL string', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 200 }).filter((s) => !s.includes('\u0000')),
        (s) => {
          expect(decodeCopyText(encodeText(s))).toBe(s)
        }
      ),
      { numRuns: 200 }
    )
  })
})

describe('property: encodeInteger / encodeFloat round-trip', () => {
  it('integers within safe range round-trip', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -Number.MAX_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER }),
        (n) => {
          const t = encodeInteger(n)
          expect(t).not.toBe('\\N')
          expect(decodeCopyText(t)).toBe(String(n))
        }
      ),
      { numRuns: 200 }
    )
  })
  it('bigints round-trip across the int8 range', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: -(2n ** 63n), max: 2n ** 63n - 1n }), (n) => {
        const t = encodeInteger(n)
        expect(decodeCopyText(t)).toBe(n.toString())
      }),
      { numRuns: 200 }
    )
  })
  it('finite floats round-trip', () => {
    fc.assert(
      fc.property(fc.double({ noNaN: true, noDefaultInfinity: true }), (n) => {
        const t = encodeFloat(n)
        expect(t === '\\N' || Number(t) === n).toBe(true)
      })
    )
  })
})

describe('boundary fillers for 100% coverage', () => {
  it('EncoderInvalidValueError formats message with column when provided', () => {
    const err = new EncoderInvalidValueError('foo', 'reason')
    expect(err.message).toContain('(column foo)')
  })

  it('encodeText coerces non-string scalar (number) via String() fallback', () => {
    // exercises the number → encodeText(String(value)) recursion path
    expect(encodeText(42)).toBe('42')
  })

  it('encodeText coerces bigint via String() fallback', () => {
    expect(encodeText(9007199254740992n)).toBe('9007199254740992')
  })

  it('encodeText coerces boolean via String() fallback', () => {
    expect(encodeText(true)).toBe('true')
  })

  it('encodeText throws EncoderInvalidValueError on object input (regression: was "[object Object]")', () => {
    expect(() => encodeText({ foo: 'bar' })).toThrow(EncoderInvalidValueError)
  })

  it('encodeInteger numeric-string passthrough', () => {
    expect(encodeInteger('123')).toBe('123')
  })

  it('encodeInteger non-numeric string fallback via String(value)', () => {
    expect(encodeInteger('abc')).toBe('abc')
  })

  it('encodeFloat non-number fallback via String(value)', () => {
    expect(encodeFloat('1.25')).toBe('1.25')
  })

  it('encodeRowsToCopyText wraps EncoderInvalidValueError with column name', async () => {
    const cols = [{ name: 'col_with_nul', encoder: encodeText }]
    async function* rows() {
      yield { col_with_nul: 'a\u0000b' }
    }
    let captured: unknown
    try {
      for await (const _row of encodeRowsToCopyText(cols, rows())) {
        void _row
        // unreachable
      }
    } catch (err) {
      captured = err
    }
    expect(captured).toBeInstanceOf(EncoderInvalidValueError)
    expect((captured as EncoderInvalidValueError).column).toBe('col_with_nul')
    expect((captured as EncoderInvalidValueError).message).toContain('(column col_with_nul)')
  })

  it('encodeRowsToCopyText rethrows non-EncoderInvalidValueError as-is', async () => {
    const sentinel = new Error('boom')
    const cols = [
      {
        name: 'x',
        encoder: () => {
          throw sentinel
        }
      }
    ]
    async function* rows() {
      yield { x: 'whatever' }
    }
    let captured: unknown
    try {
      for await (const _row of encodeRowsToCopyText(cols, rows())) {
        void _row
        // unreachable
      }
    } catch (err) {
      captured = err
    }
    expect(captured).toBe(sentinel)
  })
})
