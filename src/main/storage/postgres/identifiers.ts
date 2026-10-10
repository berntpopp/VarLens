export function quoteIdentifier(identifier: string): string {
  return `"${identifier.split('"').join('""')}"`
}

export function toNumber(value: unknown): number {
  if (typeof value === 'number') return value
  if (typeof value === 'bigint') return Number(value)
  if (typeof value === 'string') return Number(value)
  if (typeof value === 'boolean') return value ? 1 : 0
  return 0
}
