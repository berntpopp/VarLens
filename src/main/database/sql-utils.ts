/**
 * Generate comma-separated SQL placeholders for parameterized IN clauses.
 * Replaces the pattern: `arr.map(() => '?').join(', ')`
 */
export function sqlPlaceholders(count: number): string {
  return Array(count).fill('?').join(', ')
}
