// src/main/storage/postgres/copy-text-encoder.ts
//
// Pure encoders for PostgreSQL COPY ... FROM STDIN text format.
// No pg imports — fully unit-testable in isolation.

export class EncoderInvalidValueError extends Error {
  constructor(
    public readonly column: string | undefined,
    public readonly reason: string
  ) {
    super(
      `COPY encoder rejected value: ${reason}${column !== undefined && column !== '' ? ` (column ${column})` : ''}`
    )
    this.name = 'EncoderInvalidValueError'
  }
}

export type CopyColumnEncoder = (value: unknown) => string

const NULL_TOKEN = '\\N'

/**
 * Encodes a text value for COPY text format.
 * - null/undefined → \N
 * - empty string  → '' (NOT null)
 * - U+0000        → throws (Postgres `text` cannot store NUL)
 * - Escape order: \ first, then \n, \r, \t.
 *
 * Non-string scalars (number, bigint, boolean) are coerced via String().
 * Other types throw — silently coercing objects to '[object Object]' would
 * smuggle structurally meaningless tokens into the wire format.
 */
export const encodeText: CopyColumnEncoder = (value) => {
  if (value === null || value === undefined) return NULL_TOKEN
  if (typeof value !== 'string') {
    if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') {
      return encodeText(String(value))
    }
    throw new EncoderInvalidValueError(
      undefined,
      `expected string for text encoder, got ${typeof value}`
    )
  }
  if (value.indexOf('\u0000') >= 0) {
    throw new EncoderInvalidValueError(undefined, 'U+0000 not representable in PostgreSQL text')
  }
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
}

/**
 * Encodes an integer value for COPY text format.
 * Per the locked spec: NULL → \N; otherwise String(value).
 *
 * Non-finite or non-integer JS numbers throw rather than silently truncate —
 * the prior `value | 0` shortcut quietly cast values ≥ 2^31 to int32.
 */
export const encodeInteger: CopyColumnEncoder = (value) => {
  if (value === null || value === undefined) return NULL_TOKEN
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new EncoderInvalidValueError(
        undefined,
        `non-finite number ${value} not representable in PostgreSQL integer`
      )
    }
    if (!Number.isInteger(value)) {
      throw new EncoderInvalidValueError(
        undefined,
        `non-integer ${value} passed to integer encoder`
      )
    }
    return String(value)
  }
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return value
  return String(value)
}

export const encodeFloat: CopyColumnEncoder = (value) => {
  if (value === null || value === undefined) return NULL_TOKEN
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return 'NaN'
    if (value === Infinity) return 'Infinity'
    if (value === -Infinity) return '-Infinity'
    return String(value)
  }
  return String(value)
}

export interface CopyColumn {
  name: string
  encoder: CopyColumnEncoder
}

/**
 * Async generator that consumes a row producer and yields COPY text-format Buffers.
 * Each row is encoded as one line of tab-separated tokens terminated by \n.
 */
export async function* encodeRowsToCopyText(
  columns: ReadonlyArray<CopyColumn>,
  rows: AsyncIterable<Record<string, unknown>> | Iterable<Record<string, unknown>>
): AsyncGenerator<Buffer> {
  for await (const row of rows as AsyncIterable<Record<string, unknown>>) {
    const fields: string[] = new Array(columns.length)
    for (let i = 0; i < columns.length; i++) {
      const col = columns[i]
      try {
        fields[i] = col.encoder(row[col.name])
      } catch (err) {
        if (err instanceof EncoderInvalidValueError) {
          throw new EncoderInvalidValueError(col.name, err.reason)
        }
        throw err
      }
    }
    yield Buffer.from(fields.join('\t') + '\n', 'utf8')
  }
}
