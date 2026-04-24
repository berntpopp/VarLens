export function quoteIdentifier(identifier: string): string {
  return `"${identifier.split('"').join('""')}"`
}
