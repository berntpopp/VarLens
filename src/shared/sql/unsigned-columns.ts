/**
 * Columns filtered, sorted and bounded by magnitude, as the tables show them:
 * VCF SVLEN is negative for deletions, but its sign only encodes DEL vs DUP,
 * which the SV type already says. "Length > 1000" must find a 5 kb deletion.
 * The cohort summary stores these unsigned (cohort-representative.ts).
 */
export const UNSIGNED_COLUMN_KEYS: ReadonlySet<string> = new Set(['sv_length'])

/** The SQL compared for column `key` whose stored value is `reference`. */
export function comparedColumnSql(key: string, reference: string): string {
  return UNSIGNED_COLUMN_KEYS.has(key) ? `ABS(${reference})` : reference
}
