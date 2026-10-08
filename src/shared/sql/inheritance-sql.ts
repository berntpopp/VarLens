/**
 * SQL of the inheritance predicates that both backends must read the same
 * way. Table names and parameter placeholders come from the caller; the
 * genotype classes come from ./genotype-dosage.ts.
 */

/** One variant, however many rows (transcripts, duplicates) a case stores for it. */
export function variantIdentitySql(alias: string): string {
  return `${alias}.chr || ':' || CAST(${alias}.pos AS TEXT) || ':' || ${alias}.ref || ':' || ${alias}.alt`
}
