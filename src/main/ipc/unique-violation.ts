/**
 * Recognise raw unique-constraint violations from the two database drivers
 * and turn them into a user-readable conflict message:
 *
 *   - node-postgres: `code === '23505'`, with `table` and a `detail` such as
 *     `Key (name)=(Panel A) already exists.`
 *   - better-sqlite3: `code === 'SQLITE_CONSTRAINT_UNIQUE'` (or `_PRIMARYKEY`),
 *     message `UNIQUE constraint failed: region_files.name`.
 *
 * The message never echoes SQL; it names the kind of item, the column and,
 * for Postgres, the clashing value.
 */
export interface UniqueViolation {
  message: string
  userMessage: string
}

const SQLITE_UNIQUE_CODES = new Set(['SQLITE_CONSTRAINT_UNIQUE', 'SQLITE_CONSTRAINT_PRIMARYKEY'])
const PG_UNIQUE_VIOLATION = '23505'
const PG_DETAIL = /^Key \(([^)]+)\)=\((.*)\) already exists\.?$/
const SQLITE_MESSAGE = /UNIQUE constraint failed: ([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)/
const MAX_VALUE_LENGTH = 120

function humanizeTable(table: string | undefined): string {
  if (table === undefined || table === '') return 'item'
  const words = table.replace(/_/g, ' ').trim()
  return words.endsWith('ies')
    ? `${words.slice(0, -3)}y`
    : words.endsWith('s')
      ? words.slice(0, -1)
      : words
}

function humanizeColumn(column: string | undefined): string {
  if (column === undefined || column === '' || column.includes(',')) return 'name'
  return column.replace(/_/g, ' ')
}

function article(noun: string): string {
  return /^[aeiou]/i.test(noun) ? 'An' : 'A'
}

function describe(table: string | undefined, column: string | undefined, value?: string): string {
  const noun = humanizeTable(table)
  const field = humanizeColumn(column)
  const shown = value !== undefined && value.length <= MAX_VALUE_LENGTH ? ` ('${value}')` : ''
  return `${article(noun)} ${noun} with this ${field}${shown} already exists. Choose a different ${field}.`
}

function stringProp(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === 'string' ? value : undefined
}

export function uniqueViolationFromDriverError(error: unknown): UniqueViolation | undefined {
  if (error === null || typeof error !== 'object') return undefined
  const record = error as Record<string, unknown>
  const code = stringProp(record, 'code')
  const message = stringProp(record, 'message') ?? 'unique constraint violated'

  if (code === PG_UNIQUE_VIOLATION) {
    const detail = PG_DETAIL.exec(stringProp(record, 'detail') ?? '')
    return {
      message,
      userMessage: describe(stringProp(record, 'table'), detail?.[1], detail?.[2])
    }
  }

  if (code !== undefined && SQLITE_UNIQUE_CODES.has(code)) {
    const match = SQLITE_MESSAGE.exec(message)
    return { message, userMessage: describe(match?.[1], match?.[2]) }
  }

  return undefined
}
